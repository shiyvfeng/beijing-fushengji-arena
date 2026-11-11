import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { terminalStates, validateTaskInput } from '../../../packages/contracts/index.mjs';
import { normalizeAgentProviderConfig } from '../../../dist/arena/providers/provider-factory.js';

export const now = () => new Date().toISOString();
export function requireText(value, label, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error(`${label}无效`);
  return value.trim();
}

export class Store {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = join(directory, 'master.key');
    if (!existsSync(keyPath)) {
      if (existsSync(join(directory, 'arena.sqlite'))) throw new Error('缺少 master.key，请恢复备份，不能生成新密钥覆盖已有数据库');
      writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    }
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32) throw new Error('master.key 无效');
    this.db = new DatabaseSync(join(directory, 'arena.sqlite'));
    chmodSync(join(directory, 'arena.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY, value TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id, seq);
      CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
      INSERT OR IGNORE INTO meta VALUES ('schemaVersion', '1');`);
    if (this.db.prepare("SELECT value FROM meta WHERE key='schemaVersion'").get().value !== '1') throw new Error('数据库版本不兼容');
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  list(table) { return this.db.prepare(`SELECT data FROM ${this.table(table)}`).all().map(row => JSON.parse(row.data)); }
  table(name) { if (!['connections', 'profiles', 'tasks'].includes(name)) throw new Error('无效表'); return name; }
  get(table, id) {
    const row = this.db.prepare(`SELECT data FROM ${this.table(table)} WHERE id=?`).get(id);
    if (!row) throw Object.assign(new Error('记录不存在'), { status: 404 });
    return JSON.parse(row.data);
  }
  put(table, data) {
    data.updatedAt = now();
    if (table === 'tasks') this.db.prepare('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(data.id, data.status, JSON.stringify(data));
    else this.db.prepare(`INSERT INTO ${this.table(table)} VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(data.id, JSON.stringify(data));
    return data;
  }
  encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  secret(id) {
    const row = this.db.prepare('SELECT value, revoked FROM secrets WHERE id=?').get(id);
    if (!row || row.revoked) throw new Error('模型凭据已撤销');
    const data = Buffer.from(row.value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  }
  saveConnection(input, id) {
    const previous = id ? this.get('connections', id) : null;
    const name = requireText(input.name, '连接名称');
    const provider = requireText(input.provider, 'Provider');
    const baseUrl = requireText(input.baseUrl, '接口地址', 1000);
    const apiKey = input.apiKey ? requireText(input.apiKey, 'API Key', 4096) : null;
    if (!apiKey && (!previous?.secretId || previous.configured === false)) throw new Error('请填写 API Key');
    const validated = normalizeAgentProviderConfig({ provider, baseUrl, apiKey: 'validation', model: 'validation', maxOutputTokens: 512, thinkingMode: provider === 'deepseek' ? 'enabled' : 'default', reasoningEffort: 'low' });
    return this.transaction(() => {
      const secretId = apiKey ? randomUUID() : previous.secretId;
      if (apiKey) this.db.prepare('INSERT INTO secrets(id,value) VALUES (?,?)').run(secretId, this.encrypt(apiKey));
      return this.put('connections', { id: previous?.id ?? randomUUID(), name, provider: validated.provider, baseUrl: validated.baseUrl,
        secretId, configured: true, enabled: input.enabled !== false, version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? now() });
    });
  }
  publicConnection(connection) { const { secretId, ...rest } = connection; return rest; }
  revokeConnection(id) {
    return this.transaction(() => {
      const connection = this.get('connections', id);
      const secrets = new Set([connection.secretId]);
      const affected = [];
      for (const task of this.list('tasks')) {
        const agents = task.snapshot?.agents ?? task.inheritedSnapshot?.agents ?? [];
        if (agents.some(agent => agent.connectionId === id)) {
          for (const agent of agents) if (agent.connectionId === id) secrets.add(agent.secretId);
          if (['queued', 'running', 'cancelling'].includes(task.status)) affected.push(task.id);
        }
      }
      for (const secret of secrets) this.db.prepare('UPDATE secrets SET revoked=1 WHERE id=?').run(secret);
      this.put('connections', { ...connection, enabled: false, configured: false });
      return affected;
    });
  }
  saveProfile(input, id) {
    const previous = id ? this.get('profiles', id) : null;
    const connection = this.get('connections', requireText(input.connectionId, '连接'));
    const normalized = normalizeAgentProviderConfig({ ...input, provider: connection.provider, baseUrl: connection.baseUrl, apiKey: 'validation', maxOutputTokens: 512 });
    if (normalized.reasoningEffort === 'default' || normalized.reasoningEffort === 'none') throw new Error('请选择明确的非关闭思考等级');
    return this.put('profiles', { id: previous?.id ?? randomUUID(), name: requireText(input.name, '模型配置名称'), connectionId: connection.id,
      model: normalized.model, thinkingMode: normalized.thinkingMode, reasoningEffort: normalized.reasoningEffort,
      modelRevision: normalized.modelRevision ?? '', enabled: input.enabled !== false, version: (previous?.version ?? 0) + 1 });
  }
  saveTask(input, id, inheritedSnapshot) {
    const previous = id ? this.get('tasks', id) : null;
    if (previous && previous.status !== 'draft') throw new Error('只能修改草稿');
    const config = validateTaskInput(input);
    const task = { ...previous, ...config, id: previous?.id ?? randomUUID(), status: 'draft', stage: 'validate', archived: false,
      createdAt: previous?.createdAt ?? now(), sourceTaskId: previous?.sourceTaskId ?? null, inheritedSnapshot: inheritedSnapshot ?? null };
    this.snapshot(task);
    return this.put('tasks', task);
  }
  snapshot(task) {
    if (task.inheritedSnapshot) {
      for (const agent of task.inheritedSnapshot.agents) this.secret(agent.secretId);
      return { ...task.inheritedSnapshot, ...task.limits, completionAssisted: task.completionAssisted };
    }
    const agents = task.profileIds.map(id => {
      const profile = this.get('profiles', id), connection = this.get('connections', profile.connectionId);
      if (!profile.enabled || !connection.enabled) throw new Error('模型或连接已停用');
      this.secret(connection.secretId);
      return { profileId: id, profileName: profile.name, profileVersion: profile.version,
        connectionId: connection.id, connectionVersion: connection.version, secretId: connection.secretId,
        provider: connection.provider, baseUrl: connection.baseUrl, model: profile.model,
        thinkingMode: profile.thinkingMode, reasoningEffort: profile.reasoningEffort, modelRevision: profile.modelRevision,
        maxOutputTokens: task.limits.maxOutputTokens };
    });
    if (new Set(agents.map(agent => `${agent.provider}\0${agent.model}`)).size !== 5) throw new Error('五组 Provider + Model 必须互不重复');
    return { ...task.limits, completionAssisted: task.completionAssisted, agents };
  }
  start(id, engineVersion) {
    return this.transaction(() => {
      const task = this.get('tasks', id);
      if (task.status !== 'draft') return task; // A task has one execution; duplicate starts are idempotent.
      const executionId = randomUUID();
      const snapshot = { ...this.snapshot(task), matchId: `web-${executionId}`, executionId, engineVersion };
      return this.put('tasks', { ...task, snapshot, executionId, status: 'queued', queuedAt: now() });
    });
  }
  event(id, data) {
    const event = { ...data, time: now() };
    const result = this.db.prepare('INSERT INTO events(task_id,data) VALUES (?,?)').run(id, JSON.stringify(event));
    return { ...event, seq: Number(result.lastInsertRowid) };
  }
  events(id, after = 0) { return this.db.prepare('SELECT seq,data FROM events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 500').all(id, after).map(row => ({ ...JSON.parse(row.data), seq: row.seq })); }
  archive(id, archived) {
    const task = this.get('tasks', id);
    if (!terminalStates.includes(task.status)) throw new Error('只能归档已结束任务');
    return this.put('tasks', { ...task, archived });
  }
  publicTask(task) {
    const { inheritedSnapshot, ...publicTask } = task;
    if (!task.snapshot) return { ...publicTask, inheritsOriginalConfig: Boolean(inheritedSnapshot) };
    return { ...publicTask, inheritsOriginalConfig: Boolean(inheritedSnapshot), snapshot: { ...task.snapshot, agents: task.snapshot.agents.map(({ secretId, ...agent }) => agent) } };
  }
  close() { this.db.close(); this.key.fill(0); }
}
