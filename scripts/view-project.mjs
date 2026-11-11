import { buildSite, createSiteServer } from './project-site.mjs';
const args = process.argv.slice(2);
let input, enrichment, buildOnly = false, port = 5174;
try {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--build-only') { buildOnly = true; continue; }
    if (arg === '--help') {
      console.log('npm run arena:view -- --input <replay.json> [--enrichment <json>] [--port 5174] [--build-only]');
      process.exit(0);
    }
    if (!['--input', '--enrichment', '--port'].includes(arg)) throw new Error(`未知参数：${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少值`);
    if (arg === '--input') input = value;
    if (arg === '--enrichment') enrichment = value;
    if (arg === '--port') port = Number(value);
  }
  if (!input) throw new Error('请指定 --input <replay.json>，或运行 npm run arena:demo');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1..65535');
  const site = buildSite(input, enrichment);
  console.log(`静态站点目录：${site}`);
  if (!buildOnly) {
    const server = createSiteServer(site);
    server.on('error', error => { console.error(`预览启动失败：${error.message}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`打开 http://127.0.0.1:${port} 查看比赛；Ctrl+C 退出。`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
  }
} catch (error) {
  console.error(`展示失败：${error.message}`);
  process.exitCode = 1;
}
