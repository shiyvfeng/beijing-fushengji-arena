import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApplication } from '../../apps/server/src/app.mjs';
import { defaultLimits } from '../../packages/contracts/index.mjs';
const secret = 'sk-server-fixture-12345678901234567890';
const fakeEnv = { NODE_OPTIONS: `--import=${new URL('./fake-fetch.mjs', import.meta.url).href}` };
async function start(t, options = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'arena-server-test-'));
  const app = createApplication({ dataDir, allowedHosts: ['fake.invalid'], workerEnv: fakeEnv, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); if (!options.dataDir) rmSync(dataDir, { recursive: true, force: true }); });
  const request = async (path, method = 'GET', body, headers = {}) => {
    const response = await fetch(url + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Arena-Request': '1', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { response, data: await response.json() };
  };
  const api = async (...args) => { const result = await request(...args); assert.ok(result.response.ok, JSON.stringify(result.data)); return result.data; };
  return { ...app, dataDir, url, request, api };
}
async function models(app) {
  const connection = await app.api('/connections', 'POST', { name: '测试网关', provider: 'openai-compatible', baseUrl: 'https://fake.invalid/v1', apiKey: secret });
  const profiles = [];
  for (let i = 0; i < 5; i++) profiles.push(await app.api('/model-profiles', 'POST', { name: `模型 ${i}`, connectionId: connection.id, model: `model-${i}`, reasoningEffort: 'low', thinkingMode: 'default' }));
  return { connection, profiles };
}
async function task(app, profiles, extra = {}) {
  return app.api('/tasks', 'POST', { name: '自动化测试', profileIds: profiles.map(profile => profile.id), completionAssisted: false, limits: { ...defaultLimits, decisionTimeoutMs: 1000, maxActionsPerAgent: 40, totalWallClockMs: 40000 }, ...extra });
}
async function waitFor(app, id, predicate, timeout = 20000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await app.api(`/tasks/${id}`); if (predicate(value)) return value; await delay(50); }
  assert.fail(`Task ${id} timed out`);
}

test('API runs real pipeline with fake providers, freezes configuration, protects secrets and serves dynamic results', async t => {
  const app = await start(t), { connection, profiles } = await models(app);
  assert.ok(!JSON.stringify(await app.api('/connections')).includes(secret));
  assert.ok(!readFileSync(join(app.dataDir, 'arena.sqlite')).includes(Buffer.from(secret)));
  const draft = await task(app, profiles);
  assert.equal((await app.request(`/tasks/${draft.id}/start`, 'POST', {})).response.status, 400);
  const queued = await app.api(`/tasks/${draft.id}/start`, 'POST', { confirm: true });
  const duplicate = await app.api(`/tasks/${draft.id}/start`, 'POST', { confirm: true });
  assert.equal(queued.executionId, duplicate.executionId);
  await app.api(`/model-profiles/${profiles[0].id}`, 'PATCH', { ...profiles[0], model: 'changed-after-start' });
  await app.api(`/connections/${connection.id}`, 'PATCH', { ...connection, apiKey: 'new-fixture-key' });
  const complete = await waitFor(app, draft.id, value => ['succeeded', 'failed', 'interrupted'].includes(value.status));
  assert.equal(complete.status, 'succeeded', JSON.stringify(complete));
  assert.equal(complete.snapshot.agents[0].model, 'model-0');
  assert.ok(!('secretId' in complete.snapshot.agents[0]));
  const replay = await app.api(`/tasks/${draft.id}/replay`);
  assert.equal(replay.days.length, 40);
  const result = await app.api(`/tasks/${draft.id}/results`);
  assert.equal(result.report.agents.length, 5);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.ok(!existsSync(join(app.scheduler.directory(complete), 'replay.html')));
  const events = app.store.events(draft.id);
  assert.ok(events.some(event => event.type === 'progress'));
  assert.ok(events.every(event => !JSON.stringify(event).includes(secret)));
  const exported = await app.api(`/tasks/${draft.id}/exports`, 'POST', {});
  assert.equal(exported.replay.replayHash, replay.replayHash);
  assert.equal((await app.api(`/tasks/${draft.id}/archive`, 'POST', {})).archived, true);
  assert.equal((await app.api(`/tasks/${draft.id}/restore`, 'POST', {})).archived, false);
  const clone = await app.api(`/tasks/${draft.id}/clone`, 'POST', {});
  assert.notEqual(clone.id, draft.id); assert.equal(clone.status, 'draft');
  assert.equal(app.store.snapshot(app.store.get('tasks', clone.id)).agents[0].model, 'model-0');
  assert.ok(!JSON.stringify(clone).includes('secretId'));
});

test('running and queued tasks cancel without publishing a completed replay', async t => {
  const app = await start(t, { workerEnv: { ...fakeEnv, ARENA_TEST_DELAY: '3000' } });
  const { profiles } = await models(app);
  const first = await task(app, profiles), second = await task(app, profiles);
  await app.api(`/tasks/${first.id}/start`, 'POST', { confirm: true });
  await app.api(`/tasks/${second.id}/start`, 'POST', { confirm: true });
  await waitFor(app, first.id, task => task.status === 'running');
  assert.equal((await app.api(`/tasks/${second.id}`)).status, 'queued');
  await app.api(`/tasks/${first.id}/cancel`, 'POST', {});
  await app.api(`/tasks/${second.id}/cancel`, 'POST', {});
  await waitFor(app, first.id, task => task.status === 'cancelled');
  assert.equal((await app.api(`/tasks/${second.id}`)).status, 'cancelled');
  assert.equal((await app.request(`/tasks/${first.id}/replay`)).response.status, 409);
});

test('failed gate remains failed and cannot enter Match', async t => {
  const app = await start(t, { workerEnv: { ...fakeEnv, ARENA_TEST_FAIL: '1' } });
  const { profiles } = await models(app), draft = await task(app, profiles);
  await app.api(`/tasks/${draft.id}/start`, 'POST', { confirm: true });
  const failed = await waitFor(app, draft.id, task => task.status === 'failed');
  assert.equal(failed.stage, 'probe');
  const gates = await app.api(`/tasks/${draft.id}/gates`);
  assert.equal(gates['probe-summary.json'].passed, false);
  assert.ok(!app.store.events(draft.id).some(event => event.stage === 'match'));
});

test('Assisted cancellation interrupts a 15-second retry backoff without completing the match', async t => {
  const app = await start(t, { workerEnv: { ...fakeEnv, ARENA_TEST_MATCH_TRANSIENT: '1' } });
  const { profiles } = await models(app), draft = await task(app, profiles, { completionAssisted: true });
  await app.api(`/tasks/${draft.id}/start`, 'POST', { confirm: true });
  const until = Date.now() + 10000;
  let retrying = false;
  while (Date.now() < until) {
    retrying = app.store.events(draft.id).some(event => event.event === 'attempt_failed' && event.willRetry === true);
    if (retrying) break;
    await delay(30);
  }
  assert.ok(retrying, 'expected retry backoff after successful gates');
  const started = Date.now();
  await app.api(`/tasks/${draft.id}/cancel`, 'POST', {});
  await waitFor(app, draft.id, task => task.status === 'cancelled', 3000);
  assert.ok(Date.now() - started < 3000);
});

test('service restart preserves data and marks unfinished execution interrupted, without a paid rerun', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'arena-restart-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const first = await start(t, { dataDir });
  const { profiles } = await models(first), draft = await task(first, profiles);
  const queued = first.store.start(draft.id, 'fixture-version');
  first.store.put('tasks', { ...queued, status: 'running', stage: 'match' });
  await first.close();
  const second = await start(t, { dataDir });
  assert.equal((await second.api(`/tasks/${draft.id}`)).status, 'interrupted');
  assert.equal((await second.api('/connections')).length, 1);
  await delay(650); assert.equal(second.scheduler.active, null);
});

test('auth, write origin, gateway allowlist and static boundary are enforced', async t => {
  const app = await start(t, { password: 'test-admin-password' });
  assert.equal((await app.request('/tasks')).response.status, 401);
  const login = await app.request('/session', 'POST', { password: 'test-admin-password' });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.request('/tasks', 'GET', undefined, { Cookie: cookie })).response.status, 200);
  assert.equal((await app.request('/connections', 'POST', {}, { Cookie: cookie, Origin: 'https://evil.invalid' })).response.status, 403);
  assert.equal((await app.request('/connections', 'POST', { name: 'bad', provider: 'openai-compatible', baseUrl: 'http://169.254.169.254', apiKey: secret }, { Cookie: cookie })).response.status, 400);
  assert.equal((await fetch(app.url + '/.env')).status, 404);
  assert.equal((await app.request('/session', 'DELETE', {}, { Cookie: cookie })).response.status, 200);
  assert.equal((await app.request('/tasks', 'GET', undefined, { Cookie: cookie })).response.status, 401);
});

test('historical samples import read-only without configuring or calling models', async t => {
  const app = await start(t);
  const sample = await app.api('/samples/import', 'POST', { sampleId: 'gold-001' });
  assert.equal(sample.status, 'succeeded');
  assert.equal((await app.api(`/tasks/${sample.id}/replay`)).days.length, 40);
  assert.equal((await app.api(`/tasks/${sample.id}/results`)).report, null);
  assert.equal((await app.request(`/tasks/${sample.id}/start`, 'POST', { confirm: true })).response.status, 400);
  assert.equal((await app.api('/samples/import', 'POST', { sampleId: 'gold-001' })).id, sample.id);
});

test('revoking a connection cancels dependent work and requires a new key before reuse', async t => {
  const app = await start(t, { workerEnv: { ...fakeEnv, ARENA_TEST_DELAY: '3000' } });
  const { connection, profiles } = await models(app), draft = await task(app, profiles);
  await app.api(`/tasks/${draft.id}/start`, 'POST', { confirm: true });
  await waitFor(app, draft.id, task => task.status === 'running');
  const revoked = await app.api(`/connections/${connection.id}/revoke`, 'POST', { confirm: true });
  assert.equal(revoked.affectedTasks, 1);
  await waitFor(app, draft.id, task => task.status === 'cancelled');
  assert.equal((await app.api('/connections'))[0].configured, false);
  assert.equal((await app.request(`/connections/${connection.id}`, 'PATCH', connection)).response.status, 400);
});
