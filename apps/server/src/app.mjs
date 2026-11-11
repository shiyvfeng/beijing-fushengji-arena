import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, scryptSync, createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, realpathSync, statSync, mkdirSync, writeFileSync, rmSync, openSync, closeSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, now } from './store.mjs';
import { Scheduler } from './scheduler.mjs';
import { defaultModelHosts, guardedFetch, validateEndpoint } from './network.mjs';
import { createBenchDrivers } from '../../../dist/arena/bench-service.js';
import { runEpisode } from '../../../dist/arena/episode-runner.js';
import { DEFAULT_SCENARIO } from '../../../dist/core/scenario.js';
import { defaultLimits } from '../../../packages/contracts/index.mjs';
import { validateReplay } from '../../../showcase/scripts/build-arena-replay.mjs';
import { adaptCoreMatchReplay } from '../../../showcase/web/src/replay-adapter.ts';
import { generateReplayEnrichment } from '../../../showcase/web/src/enrichment.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const json = (response, status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(data)); };
async function body(request) {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw Object.assign(new Error('需要 JSON 请求'), { status: 415 });
  let bytes = 0, chunks = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 128 * 1024) throw Object.assign(new Error('请求过大'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new Error('JSON 无效'); }
}

export function createApplication(options = {}) {
  const directory = resolve(options.dataDir ?? (process.env.ARENA_DATA_DIR || join(root, 'var')));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, 'server.lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('数据目录锁损坏，请确认无服务运行后移除 server.lock');
    try { process.kill(pid, 0); throw new Error('该数据目录已被另一个服务使用'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; rmSync(lock); }
  }
  const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  let store;
  try { store = new Store(directory); } catch (error) { rmSync(lock); throw error; }
  const allowedHosts = options.allowedHosts ?? [...new Set([...defaultModelHosts, ...(process.env.ARENA_ALLOWED_MODEL_HOSTS ?? '').split(',').map(value => value.trim()).filter(Boolean)])];
  const scheduler = new Scheduler(store, { allowedHosts, workerEnv: options.workerEnv ?? {} });
  const staticDir = resolve(options.staticDir ?? join(root, 'apps/web/dist'));
  const password = options.password ?? process.env.ARENA_ADMIN_PASSWORD ?? '';
  const passwordHash = password ? scryptSync(password, 'arena-admin-v1', 32) : null;
  const secureCookie = options.secureCookie ?? process.env.ARENA_COOKIE_SECURE === 'true';
  const sessions = new Map(), loginFailures = new Map(), streams = new Set();
  const engineHash = createHash('sha256');
  for (const path of readdirSync(join(root, 'dist')).filter(path => path.endsWith('.js')).sort()) engineHash.update(path).update(readFileSync(join(root, 'dist', path)));
  for (const section of ['core', 'arena']) {
    const base = join(root, 'dist', section);
    for (const path of readdirSync(base, { recursive: true }).map(String).filter(path => path.endsWith('.js')).sort()) engineHash.update(section + '/' + path).update(readFileSync(join(base, path)));
  }
  const engineVersion = engineHash.digest('hex');
  let testingModel = false, shuttingDown = false;
  const authenticated = request => {
    if (!passwordHash) return true;
    const token = /(?:^|;\s*)arena_session=([a-f0-9]+)/.exec(request.headers.cookie ?? '')?.[1];
    const expiry = token && sessions.get(token);
    return Boolean(expiry && expiry > Date.now());
  };
  const readArtifact = (task, name) => JSON.parse(readFileSync(join(scheduler.directory(task), name), 'utf8'));
  const completedTask = id => {
    const task = store.get('tasks', id);
    if (task.status !== 'succeeded') throw Object.assign(new Error('结果尚未就绪'), { status: 409 });
    if (task.imported) {
      const replay = readArtifact(task, 'replay.json'); validateReplay(replay); return task;
    }
    if (!scheduler.verifyManifest(task)) throw new Error('结果清单校验失败');
    return task;
  };
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(request.url, 'http://localhost');
      const path = url.pathname, method = request.method;
      // Prevent hostile websites and DNS rebinding from using a local, passwordless control plane.
      const requestHost = request.headers.host ?? '';
      if (!passwordHash && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(requestHost)) throw Object.assign(new Error('本地模式不接受该 Host'), { status: 403 });
      if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(method)) {
        const origin = request.headers.origin;
        if (request.headers['x-arena-request'] !== '1' || (origin && new URL(origin).host !== requestHost)) throw Object.assign(new Error('请求来源不允许'), { status: 403 });
      }
      if (path === '/api/session' && method === 'GET') return json(response, 200, { authenticated: authenticated(request), requiresLogin: Boolean(passwordHash), csrfHeader: 'X-Arena-Request' });
      if (path === '/api/session' && method === 'POST') {
        const input = await body(request), ip = request.socket.remoteAddress;
        const previous = loginFailures.get(ip), attempts = previous && previous.until > Date.now() ? previous.count : 0;
        if (attempts >= 5) throw Object.assign(new Error('登录尝试过多，请 10 分钟后重试'), { status: 429 });
        const valid = passwordHash && typeof input.password === 'string' && input.password.length <= 4096 && timingSafeEqual(passwordHash, scryptSync(input.password, 'arena-admin-v1', 32));
        if (!valid) { loginFailures.set(ip, { count: attempts + 1, until: Date.now() + 600000 }); throw Object.assign(new Error('密码错误'), { status: 401 }); }
        loginFailures.delete(ip);
        for (const [token, expiry] of sessions) if (expiry < Date.now()) sessions.delete(token);
        const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 12 * 3600000);
        response.setHeader('Set-Cookie', `arena_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secureCookie ? '; Secure' : ''}`);
        return json(response, 200, { authenticated: true });
      }
      if (path.startsWith('/api/') && !authenticated(request)) throw Object.assign(new Error('请先登录'), { status: 401 });
      if (path === '/api/session' && method === 'DELETE') {
        const token = /arena_session=([a-f0-9]+)/.exec(request.headers.cookie ?? '')?.[1]; sessions.delete(token);
        response.setHeader('Set-Cookie', 'arena_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(response, 200, { ok: true });
      }
      if (path === '/api/settings' && method === 'GET') return json(response, 200, {
        concurrency: 1, allowedHosts, engineVersion, localMode: !passwordHash, dataDir: directory,
        taskCount: store.list('tasks').length, databaseBytes: statSync(join(directory, 'arena.sqlite')).size,
      });
      if (path === '/api/connections' && method === 'GET') return json(response, 200, store.list('connections').map(item => store.publicConnection(item)));
      const connectionRoute = /^\/api\/connections(?:\/([a-f0-9-]+))?$/.exec(path);
      if (connectionRoute && ['POST', 'PATCH'].includes(method)) {
        const input = await body(request); validateEndpoint(input.baseUrl, allowedHosts);
        const result = store.saveConnection(input, connectionRoute[1]);
        return json(response, 200, store.publicConnection(result));
      }
      const listModels = /^\/api\/connections\/([a-f0-9-]+)\/models:refresh$/.exec(path);
      const revoke = /^\/api\/connections\/([a-f0-9-]+)\/revoke$/.exec(path);
      if (revoke && method === 'POST') {
        if ((await body(request)).confirm !== true) throw new Error('撤销凭据需要确认');
        const affected = store.revokeConnection(revoke[1]);
        for (const id of affected) { scheduler.record(id, { type: 'credential_revoked' }); scheduler.cancel(id); }
        return json(response, 200, { revoked: true, affectedTasks: affected.length });
      }
      if (listModels && method === 'POST') {
        await body(request);
        const connection = store.get('connections', listModels[1]);
        const base = connection.baseUrl.replace(/\/$/, '');
        const endpoint = base.endsWith('/v1') || base.endsWith('/compatible-mode/v1') ? `${base}/models` : `${base}/v1/models`;
        const key = store.secret(connection.secretId);
        const headers = connection.provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${key}` };
        try {
          const result = await guardedFetch(allowedHosts, AbortSignal.timeout(15000))(endpoint, { headers });
          if (!result.ok) throw new Error();
          const data = await result.json();
          const models = (Array.isArray(data.data) ? data.data : []).map(item => item.id).filter(id => typeof id === 'string').slice(0, 1000);
          return json(response, 200, { models });
        } catch { throw new Error('模型列表查询失败，可以手动填写模型 ID'); }
      }
      if (path === '/api/model-profiles' && method === 'GET') return json(response, 200, store.list('profiles').map(profile => ({ ...profile, connectionEnabled: store.get('connections', profile.connectionId).enabled })));
      const profileRoute = /^\/api\/model-profiles(?:\/([a-f0-9-]+))?$/.exec(path);
      if (profileRoute && ['POST', 'PATCH'].includes(method)) return json(response, 200, store.saveProfile(await body(request), profileRoute[1]));
      const testProfile = /^\/api\/model-profiles\/([a-f0-9-]+)\/test$/.exec(path);
      if (testProfile && method === 'POST') {
        const input = await body(request); if (input.confirm !== true) throw new Error('请确认测试会发起模型请求');
        if (testingModel) throw Object.assign(new Error('已有连接测试正在执行'), { status: 409 });
        const profile = store.get('profiles', testProfile[1]), connection = store.get('connections', profile.connectionId);
        if (!profile.enabled || !connection.enabled) throw new Error('请先启用模型及其供应商连接');
        const config = { ...defaultLimits, matchId: `test-${randomUUID()}`, completionAssisted: false,
          agents: Array.from({ length: 5 }, () => ({ ...profile, provider: connection.provider, baseUrl: connection.baseUrl, apiKey: store.secret(connection.secretId), maxOutputTokens: 512 })) };
        testingModel = true;
        try {
          const signal = AbortSignal.timeout(30000);
          const [driver] = createBenchDrivers(config, { fetchImpl: guardedFetch(allowedHosts, signal) });
          const result = await runEpisode({ ...config, driver, scenario: DEFAULT_SCENARIO, maxActions: 1, decisionTimeoutMs: 30000, signal });
          const passed = result.report.validActionCount > 0 || result.report.validActions > 0;
          const saved = store.put('profiles', { ...profile, test: { passed, at: now(), connectionVersion: connection.version } });
          return json(response, 200, saved.test);
        } catch {
          const test = { passed: false, at: now(), connectionVersion: connection.version, message: '模型请求失败或超时' };
          store.put('profiles', { ...profile, test }); return json(response, 200, test);
        }
        finally { testingModel = false; }
      }
      if (path === '/api/tasks' && method === 'GET') return json(response, 200, store.list('tasks').map(task => store.publicTask(task)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      if (path === '/api/tasks' && method === 'POST') return json(response, 201, store.publicTask(store.saveTask(await body(request))));
      if (path === '/api/samples/import' && method === 'POST') {
        const { sampleId } = await body(request);
        if (!['gold-001', 'gold-002'].includes(sampleId)) throw new Error('未知演示样本');
        const prior = store.list('tasks').find(task => task.sampleId === sampleId);
        if (prior) return json(response, 200, store.publicTask(prior));
        const replay = JSON.parse(readFileSync(join(root, 'showcase/samples', sampleId, 'replay.json'))); validateReplay(replay);
        const task = { id: randomUUID(), executionId: randomUUID(), name: `历史演示 · ${sampleId}`, imported: true, sampleId, status: 'succeeded', stage: 'ready', archived: false, createdAt: now(), finishedAt: now(), completionAssisted: true, limits: { ...defaultLimits, seed: replay.seed } };
        mkdirSync(scheduler.directory(task), { recursive: true, mode: 0o700 });
        writeFileSync(join(scheduler.directory(task), 'replay.json'), JSON.stringify(replay), { mode: 0o600 });
        store.put('tasks', task); return json(response, 201, task);
      }
      const taskRoute = /^\/api\/tasks\/([a-f0-9-]+)(?:\/(events|start|cancel|clone|archive|restore|results|replay|enrichment|gates|exports))?$/.exec(path);
      if (taskRoute) {
        const [, id, action] = taskRoute, task = store.get('tasks', id);
        if (!action && method === 'GET') return json(response, 200, store.publicTask(task));
        if (!action && method === 'PATCH') return json(response, 200, store.publicTask(store.saveTask(await body(request), id)));
        if (action === 'events' && method === 'GET') {
          let after = Number(request.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
          if (!Number.isSafeInteger(after) || after < 0) throw new Error('事件序号无效');
          response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          const push = () => {
            if (!authenticated(request)) { response.end(); return; }
            const events = store.events(id, after);
            for (const event of events) {
              after = event.seq;
              if (!response.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) { response.end(); return; }
            }
          };
          push(); const interval = setInterval(() => { push(); if (!response.writableEnded) response.write(': heartbeat\n\n'); }, 1000);
          streams.add(response);
          response.on('close', () => { clearInterval(interval); streams.delete(response); }); return;
        }
        if (method === 'POST') {
          const input = await body(request);
          if (action === 'start') {
            if (input.confirm !== true) throw new Error('请确认本次启动将调用模型并产生费用');
            if (task.imported) throw new Error('历史样本不能启动');
            return json(response, 200, store.publicTask(store.start(id, engineVersion)));
          }
          if (action === 'cancel') return json(response, 200, store.publicTask(scheduler.cancel(id)));
          if (action === 'archive' || action === 'restore') return json(response, 200, store.publicTask(store.archive(id, action === 'archive')));
          if (action === 'clone') {
            if (task.imported) throw new Error('历史样本不包含可用的模型连接，请创建新任务');
            const copy = store.saveTask({ ...task, name: `${task.name.slice(0, 88)} · 重跑` }, undefined, task.snapshot ?? task.inheritedSnapshot);
            store.put('tasks', { ...copy, sourceTaskId: task.id }); return json(response, 201, store.publicTask(store.get('tasks', copy.id)));
          }
          if (action === 'exports') {
            const complete = completedTask(id);
            const data = { schemaVersion: 'arena-result-export-v1', replay: readArtifact(complete, 'replay.json'), report: complete.imported ? null : readArtifact(complete, 'run-report.json') };
            response.setHeader('Content-Disposition', `attachment; filename="arena-${id}.json"`); return json(response, 200, data);
          }
        }
        if (method === 'GET' && ['results', 'replay', 'enrichment'].includes(action)) {
          const complete = completedTask(id), replay = readArtifact(complete, 'replay.json'); validateReplay(replay);
          if (action === 'replay') return json(response, 200, replay);
          if (action === 'enrichment') return json(response, 200, generateReplayEnrichment(adaptCoreMatchReplay(replay)));
          return json(response, 200, { finalRanking: replay.finalRanking, agents: replay.agents, report: complete.imported ? null : readArtifact(complete, 'run-report.json'), imported: Boolean(complete.imported) });
        }
        if (method === 'GET' && action === 'gates') {
          const data = {};
          if (task.executionId) for (const name of ['probe-summary.json', 'stability-summary.json']) {
            if (existsSync(join(scheduler.directory(task), name))) data[name] = readArtifact(task, name);
          }
          return json(response, 200, data);
        }
      }
      if (path.startsWith('/api/')) return json(response, 404, { error: '接口不存在' });
      if (!['GET', 'HEAD'].includes(method)) return json(response, 405, { error: '方法不支持' });
      if (decodeURIComponent(path).split('/').some(part => part.startsWith('.'))) return json(response, 404, { error: '文件不存在' });
      if (!existsSync(staticDir)) return json(response, 503, { error: '请先运行 npm run build 或 npm run dev' });
      const requested = resolve(staticDir, '.' + decodeURIComponent(path));
      if (!requested.startsWith(staticDir + sep) && requested !== staticDir) throw Object.assign(new Error('路径无效'), { status: 404 });
      const file = existsSync(requested) && statSync(requested).isFile() ? realpathSync(requested) : (extname(path) ? null : join(staticDir, 'index.html'));
      if (!file || !file.startsWith(realpathSync(staticDir) + sep) || !mime[extname(file)]) return json(response, 404, { error: '文件不存在' });
      response.writeHead(200, { 'Content-Type': mime[extname(file)], 'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
      response.end(method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const message = error.code === 'ENOENT' ? '数据尚未就绪' : error.message;
      json(response, error.status ?? 400, { error: message });
    }
  });
  server.requestTimeout = 35000;
  const close = async () => {
    if (shuttingDown) return; shuttingDown = true;
    scheduler.close(); for (const stream of streams) stream.end();
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    store.close(); rmSync(lock, { force: true });
  };
  return { server, store, scheduler, close, directory };
}
