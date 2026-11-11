import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dataScript } from '../../scripts/project-site.mjs';

test('embedded JSON cannot terminate its data script', () => {
  const script = dataScript('arena-replay-data', { text: '</script><script>alert(1)</script>' });
  assert.equal((script.match(/<script/g) ?? []).length, 1);
  assert.ok(script.includes('\\u003c/script>'));
});

test('imported samples retain the frozen byte hashes', () => {
  const catalog = JSON.parse(readFileSync(new URL('../../showcase/samples/catalog.json', import.meta.url)));
  for (const sample of catalog.samples) {
    const bytes = readFileSync(new URL(`../../showcase/samples/${sample.replayPath}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sample.replayFileSha256);
  }
});

test('one-command run requires explicit live authorization', () => {
  const result = spawnSync(process.execPath, ['scripts/run-project.mjs', '--output-dir', 'dist/should-not-exist'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /confirm-live-run/);
});

test('simultaneous exports use isolated build directories and remain deterministic', { timeout: 90_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-parallel-export-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const outputs = [join(directory, 'one.html'), join(directory, 'two.html')];
  await Promise.all(outputs.map(output => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['showcase/scripts/build-arena-replay.mjs',
      '--input', 'showcase/samples/gold-001/replay.json', '--output', output], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  const hashes = outputs.map(path => createHash('sha256').update(readFileSync(path)).digest('hex'));
  assert.equal(hashes[0], hashes[1]);
});

test('one-command workflow completes Probe, Stability, Match and Showcase with fake providers', { timeout: 180_000 }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-project-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const config = join(directory, '.env');
  writeFileSync(config, '');
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('ARENA_')) delete env[name];
  env.NODE_OPTIONS = `--import=${new URL('../core/fixtures/direct-fetch-shim.mjs', import.meta.url).href}`;
  for (const [index, letter] of [...'ABCDE'].entries()) {
    Object.assign(env, {
      [`ARENA_AGENT_${letter}_PROVIDER`]: 'openai-compatible',
      [`ARENA_AGENT_${letter}_BASE_URL`]: `https://${letter.toLowerCase()}.invalid/v1`,
      [`ARENA_AGENT_${letter}_API_KEY`]: `sk-project-fixture-${letter}-123456789`,
      [`ARENA_AGENT_${letter}_MODEL`]: `model-${index + 1}`,
      [`ARENA_AGENT_${letter}_REASONING_EFFORT`]: 'low',
    });
  }
  const output = join(directory, 'run');
  const result = spawnSync(process.execPath, ['scripts/run-project.mjs', '--env-file', config,
    '--output-dir', output, '--match-id', 'project-fixture', '--max-actions-per-agent', '40',
    '--decision-timeout-ms', '1000', '--total-wall-clock-ms', '40000', '--confirm-live-run'],
    { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 170_000 });
  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-5000));
  for (const name of ['probe-summary.json', 'stability-summary.json', 'replay.json', 'replay.html']) assert.ok(existsSync(join(output, name)), name);
  const replay = JSON.parse(readFileSync(join(output, 'replay.json')));
  const html = readFileSync(join(output, 'replay.html'), 'utf8');
  assert.equal(replay.days.length, 40);
  assert.ok(html.includes(replay.replayHash));
  assert.ok(html.includes('事实与高光分层'));
  assert.ok(!html.includes('sk-project-fixture'));
});
