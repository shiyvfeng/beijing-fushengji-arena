import { createApplication } from './app.mjs';
const host = process.env.ARENA_HOST || '127.0.0.1';
const port = Number(process.env.ARENA_PORT || 3000);
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && (process.env.ARENA_ADMIN_PASSWORD?.length ?? 0) < 12) throw new Error('远程监听需要至少 12 位 ARENA_ADMIN_PASSWORD');
const app = createApplication();
app.server.on('error', async error => { console.error(error.message); await app.close(); process.exitCode = 1; });
app.server.listen(port, host, () => console.log(`Arena 控制台：http://${host}:${port}\n数据目录：${app.directory}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void app.close());
