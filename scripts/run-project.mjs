import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--confirm-live-run') || args.includes('--help')) {
  console.log('用法：npm run arena:run -- --output-dir dist/runs/my-match --confirm-live-run [--completion-assisted] [其他 Runner 参数]\n此命令授权并依次执行付费 Probe、Stability、Match；任一步失败立即停止。');
  process.exit(args.includes('--help') ? 0 : 1);
}
const forbidden = ['--probe-providers', '--stability-probe', '--check-config', '--accept-assisted-probe', '--accept-assisted-stability', '--skip-assisted-stability'];
if (args.some(arg => forbidden.includes(arg))) throw new Error('一键运行要求所有门禁通过；诊断或豁免请使用 arena:direct。');
const outputIndex = args.indexOf('--output-dir');
if (outputIndex < 0 || !args[outputIndex + 1] || args[outputIndex + 1].startsWith('--')) throw new Error('必须指定新的 --output-dir');
const common = args.filter(arg => arg !== '--confirm-live-run');
for (const gate of ['--check-config', '--probe-providers', '--stability-probe', '--confirm-live-run']) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/run-arena-direct.mjs'), ...common, gate], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`比赛完成。查看：npm run arena:view -- --input ${JSON.stringify(resolve(root, args[outputIndex + 1], 'replay.json'))}`);
