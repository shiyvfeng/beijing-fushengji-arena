import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPotentialSecrets } from '../../../dist/core/secret-scan.js';
import { now } from './store.mjs';

export class Scheduler extends EventEmitter {
  constructor(store, options) {
    super(); this.store = store; this.options = options; this.active = null; this.closed = false;
    for (const task of store.list('tasks')) {
      if (['running', 'cancelling'].includes(task.status)) {
        const complete = task.status === 'running' && this.verifyManifest(task);
        store.put('tasks', { ...task, status: complete ? 'succeeded' : 'interrupted', stage: complete ? 'ready' : task.stage,
          finishedAt: now(), error: complete ? null : '服务中断；未自动重跑付费步骤' });
        this.record(task.id, { type: 'recovery', completed: complete });
      }
    }
    this.timer = setInterval(() => this.tick(), 500);
    this.timer.unref();
  }
  directory(task) { return join(this.store.directory, 'tasks', task.id, task.executionId); }
  verifyManifest(task) {
    try {
      const directory = this.directory(task), manifest = JSON.parse(readFileSync(join(directory, 'manifest.json')));
      if (manifest.executionId !== task.executionId) return false;
      const required = ['probe-summary.json', 'stability-summary.json', 'replay.json', 'episode-traces.json', 'run-report.json'];
      if (manifest.artifacts.length !== required.length) return false;
      return required.every(name => {
        const entry = manifest.artifacts.find(item => item.name === name);
        return entry && entry.sha256 === createHash('sha256').update(readFileSync(join(directory, name))).digest('hex');
      });
    } catch { return false; }
  }
  record(id, event) {
    if (findPotentialSecrets(event).length) return;
    const result = this.store.event(id, event);
    this.emit('event', id, result);
  }
  tick() {
    if (this.closed) return;
    if (this.active) {
      if (Date.now() - this.active.heartbeat > 30000) this.stopActive('interrupted', 'Worker 心跳中断');
      return;
    }
    let claimed;
    try {
      claimed = this.store.transaction(() => {
        const task = this.store.list('tasks').filter(task => task.status === 'queued').sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))[0];
        if (!task) return null;
        return this.store.put('tasks', { ...task, status: 'running', startedAt: now(), stage: 'validate' });
      });
      if (!claimed) return;
      const config = { ...claimed.snapshot, agents: claimed.snapshot.agents.map(agent => ({ ...agent, apiKey: this.store.secret(agent.secretId) })) };
      const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      const child = fork(fileURLToPath(new URL('./worker.mjs', import.meta.url)), [], { env: { ...env, ...this.options.workerEnv }, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      this.active = { id: claimed.id, child, heartbeat: Date.now() };
      this.record(claimed.id, { type: 'status', status: 'running', stage: 'validate' });
      child.on('message', message => this.onMessage(claimed.id, message));
      child.on('error', () => this.finish(claimed.id, 'failed', 'Worker 启动失败'));
      child.on('exit', () => {
        if (this.active?.id === claimed.id) {
          const current = this.store.get('tasks', claimed.id);
          this.finish(claimed.id, current.status === 'cancelling' ? 'cancelled' : 'interrupted', 'Worker 已退出');
        }
      });
      child.send({ type: 'run', config, directory: this.directory(claimed), allowedHosts: this.options.allowedHosts });
    } catch {
      if (claimed) this.finish(claimed.id, 'failed', '任务配置或凭据不可用');
    }
  }
  onMessage(id, message) {
    if (this.active?.id !== id) return;
    this.active.heartbeat = Date.now();
    if (message.type === 'heartbeat') return;
    const task = this.store.get('tasks', id);
    if (message.type === 'stage') {
      this.store.put('tasks', { ...task, stage: message.stage }); this.record(id, message);
    } else if (message.type === 'progress') this.record(id, { type: 'progress', ...message.event });
    else if (message.type === 'complete') {
      if (task.status === 'cancelling') this.finish(id, 'cancelled');
      else this.finish(id, this.verifyManifest(task) ? 'succeeded' : 'failed', this.verifyManifest(task) ? null : '结果清单校验失败');
    } else if (['failed', 'cancelled'].includes(message.type)) this.finish(id, task.status === 'cancelling' ? 'cancelled' : message.type, message.message);
  }
  finish(id, status, error = null) {
    const task = this.store.get('tasks', id);
    this.store.put('tasks', { ...task, status, error, finishedAt: now(), ...(status === 'succeeded' ? { stage: 'ready' } : {}) });
    this.record(id, { type: 'status', status, error });
    if (this.active?.id === id) { clearTimeout(this.active.killTimer); this.active = null; }
  }
  cancel(id) {
    const task = this.store.get('tasks', id);
    if (task.status === 'queued' || task.status === 'draft') this.finish(id, 'cancelled');
    else if (task.status === 'running') {
      this.store.put('tasks', { ...task, status: 'cancelling' });
      this.record(id, { type: 'status', status: 'cancelling' });
      if (this.active?.id === id) {
        this.active.child.send({ type: 'cancel' });
        this.active.killTimer = setTimeout(() => { if (this.active?.id === id) this.stopActive('cancelled'); }, 5000);
      }
    }
    return this.store.get('tasks', id);
  }
  stopActive(status, error) {
    if (!this.active) return;
    const { id, child } = this.active;
    child.kill('SIGKILL');
    this.finish(id, status, error);
  }
  close() { this.closed = true; clearInterval(this.timer); this.stopActive('interrupted', '服务已停止；可复制任务重新运行'); }
}
