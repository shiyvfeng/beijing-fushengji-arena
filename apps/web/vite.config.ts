import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const publicRoot = join(root, 'showcase/web/public');
const manifest = JSON.parse(readFileSync(join(publicRoot, 'assets/asset-manifest.json'), 'utf8'));
const assets = new Set<string>(Object.values(manifest.assets).map((entry: any) => entry.relativePath.replace(/^\.\//, '')));
export default defineConfig({
  plugins: [react(), {
    name: 'arena-runtime-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0].replace(/^\//, '') ?? '';
        if (!assets.has(path)) return next();
        response.setHeader('Content-Type', path.endsWith('.svg') ? 'image/svg+xml' : 'image/png');
        response.end(readFileSync(join(publicRoot, path)));
      });
    },
    writeBundle() {
      for (const path of assets) {
        const target = join(root, 'apps/web/dist', path);
        mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(publicRoot, path), target);
      }
    },
  }],
  publicDir: false,
  // The standalone replay stylesheet owns global selectors. Constrain them in
  // this app so visiting a replay cannot restyle the surrounding workspace.
  css: { postcss: { plugins: [{
    postcssPlugin: 'arena-embedded-replay-scope',
    Once(root) {
      if (!root.source?.input.file?.replaceAll('\\', '/').endsWith('/showcase/web/src/styles.css')) return;
      root.walkRules(rule => {
        let parent = rule.parent;
        while (parent) {
          if (parent.type === 'atrule' && /keyframes$/.test(parent.name)) return;
          parent = parent.type === 'root' ? undefined : parent.parent;
        }
        rule.selectors = rule.selectors.map(selector => /^(?:html|body|:root)(?=[\s.:#]|$)/.test(selector)
          ? selector.replace(/^(?:html|body|:root)/, '.embedded-replay')
          : `.embedded-replay ${selector}`);
      });
    },
  }] } },
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
  build: { outDir: 'dist', emptyOutDir: true },
});
