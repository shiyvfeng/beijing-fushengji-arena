import { copyFileSync, constants, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
for (const directory of ['.']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], {
    cwd: directory, stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync('.env')) copyFileSync('.env.example', '.env', constants.COPYFILE_EXCL);
console.log('依赖已安装。运行 npm run dev，在 http://127.0.0.1:5173 的模型管理页面配置连接和模型。');
