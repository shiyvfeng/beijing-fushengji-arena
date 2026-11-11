import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { executeBench } from '../../../dist/arena/bench-service.js';
import { guardedFetch } from './network.mjs';
const abort = new AbortController();
const send = message => { if (process.connected) process.send(message); };
const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 1000);
heartbeat.unref();
process.on('disconnect', () => { abort.abort(new Error('服务连接中断')); setTimeout(() => process.exit(1), 100).unref(); });
process.on('SIGTERM', () => abort.abort(new Error('任务已取消')));
let started = false;
process.on('message', async message => {
  if (message.type === 'cancel') { abort.abort(new Error('任务已取消')); return; }
  if (message.type !== 'run' || started) return;
  started = true;
  const { config, directory, allowedHosts } = message;
  const artifacts = [];
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    await executeBench(config, {
      signal: abort.signal, fetchImpl: guardedFetch(allowedHosts, abort.signal),
      onStage: stage => send({ type: 'stage', stage }),
      onProgress: event => send({ type: 'progress', event }),
      onArtifact: (name, data) => {
        const content = JSON.stringify(data);
        writeFileSync(join(directory, `${name}.tmp`), content, { mode: 0o600, flag: 'wx' });
        renameSync(join(directory, `${name}.tmp`), join(directory, name));
        artifacts.push({ name, sha256: createHash('sha256').update(content).digest('hex') });
      },
    });
    abort.signal.throwIfAborted();
    writeFileSync(join(directory, 'manifest.json.tmp'), JSON.stringify({ executionId: config.executionId, artifacts }), { mode: 0o600, flag: 'wx' });
    renameSync(join(directory, 'manifest.json.tmp'), join(directory, 'manifest.json'));
    send({ type: 'complete' });
  } catch (error) {
    // Only stable pipeline errors leave the worker; provider bodies and keys never do.
    const message = ['Provider Probe 未全部通过', '十步 Stability 未全部通过', '产物包含疑似敏感信息'].includes(error.message) ? error.message : '执行失败，请查看任务阶段和脱敏事件';
    send({ type: abort.signal.aborted ? 'cancelled' : 'failed', message });
  } finally {
    clearInterval(heartbeat);
    process.disconnect?.();
  }
});
