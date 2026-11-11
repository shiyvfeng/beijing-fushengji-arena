import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, cpSync, realpathSync, statSync, rmSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReplay, containsPotentialSecret, sanitizedEnvironment } from '../showcase/scripts/build-arena-replay.mjs';
import { adaptCoreMatchReplay } from '../showcase/web/src/replay-adapter.ts';
import { generateReplayEnrichment, validateReplayEnrichment } from '../showcase/web/src/enrichment.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const web = join(root, 'showcase/web');

export function dataScript(id, value) {
  return `<script id="${id}" type="application/json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`;
}

export function buildSite(input, enrichmentPath) {
  const replay = JSON.parse(readFileSync(resolve(input), 'utf8'));
  validateReplay(replay);
  const adapted = adaptCoreMatchReplay(replay);
  const enrichment = enrichmentPath
    ? JSON.parse(readFileSync(resolve(enrichmentPath), 'utf8'))
    : generateReplayEnrichment(adapted);
  if (containsPotentialSecret(enrichment)) throw new Error('Enrichment 包含疑似凭据');
  validateReplayEnrichment(enrichment, adapted);
  mkdirSync(join(root, 'dist/sites'), { recursive: true });
  const output = mkdtempSync(join(root, 'dist/sites/match-'));
  const temporary = join(output, '.build');
  const env = sanitizedEnvironment();
  // Vite 构建不得继承本机额外的 VITE_* 或其他构建模式。
  for (const key of Object.keys(env)) if (key.startsWith('VITE_') || key.startsWith('ARENA_BUILD_')) delete env[key];
  env.ARENA_BUILD_SESSION = '1';
  const vite = join(dirname(createRequire(join(web, 'package.json')).resolve('vite/package.json')), 'bin/vite.js');
  const build = spawnSync(process.execPath, [vite, 'build', '--outDir', temporary], {
    cwd: web, env, stdio: 'inherit',
  });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('展示站点构建失败，请先运行 npm run setup');
  const site = join(output, 'public');
  cpSync(temporary, site, {
    recursive: true,
    filter: path => statSync(path).isDirectory() || /\.(?:html|js|css|png|webp|jpg|jpeg|svg|ico|woff2?)$/i.test(path),
  });
  rmSync(temporary, { recursive: true });
  const marker = dataScript('arena-session-data', { matchId: replay.matchId });
  for (const page of ['index.html', 'replay.html', 'rules.html']) {
    const path = join(site, page);
    const payload = page === 'replay.html'
      ? dataScript('arena-replay-data', replay) + dataScript('arena-replay-enrichment-data', enrichment)
      : '';
    writeFileSync(path, readFileSync(path, 'utf8').replace('</body>', `${marker}${payload}</body>`));
  }
  return site;
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

export function createSiteServer(directory) {
  const site = realpathSync(directory);
  return createServer((request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const path = realpathSync(resolve(site, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`));
      if (!path.startsWith(site + sep) || !statSync(path).isFile() || !mime[extname(path)]) throw new Error('Not found');
      response.writeHead(200, { 'Content-Type': mime[extname(path)], 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : readFileSync(path));
    } catch {
      response.writeHead(404); response.end('Not found');
    }
  });
}
