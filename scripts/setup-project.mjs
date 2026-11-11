import { copyFileSync, constants, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
for (const directory of ['.', 'web', 'showcase', 'showcase/web']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], {
    cwd: directory, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync('.env')) copyFileSync('.env.example', '.env', constants.COPYFILE_EXCL);
console.log('依赖已安装。请填写 .env 中五组模型与 API Key，然后运行 npm run arena:direct -- --check-config。');
