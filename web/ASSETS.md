# Arena 素材替换说明

首版所有插画都通过逻辑 `assetId` 引用。可审计清单 [`public/assets/asset-manifest.json`](./public/assets/asset-manifest.json) 是素材路径、替代文本、比例与溯源信息的唯一数据源；[`src/asset-manifest.ts`](./src/asset-manifest.ts) 只负责导入、类型投影与运行时校验。组件不直接持有图片路径、URL 或来源信息。

## 替换步骤

1. 将新的本地素材放入 `public/assets/illustrations/`，不要使用 CDN 或运行时远程 URL。
2. 只修改 `public/assets/asset-manifest.json` 中对应条目的 `relativePath`、`alt`、宽高比和来源记录；不要在 TypeScript 再复制一份路径。
3. 为生成或授权素材补同名记录文件，至少写明来源、生成日期或授权日期、Prompt（如适用）、Seed、SHA-256、人工修改和公开传播边界。
4. 执行 `npm run build`；普通静态站输出到 `dist/site/`，完全内联的离线文件输出为 `dist/replay.html`。

要把核心程序生成的 `MatchReplay` 内嵌进离线文件，可执行：

```bash
ARENA_REPLAY_JSON=/absolute/path/to/replay.json npm run build
```

也可在完成 Vite 构建后运行 `node scripts/build-replay.mjs /absolute/path/to/replay.json`。脚本会把 JSON 注入 `#arena-replay-data`，前端优先适配这份核心数据；没有注入数据时才使用 `src/sample-replay.ts` 的显式开发样例。

图片缺失或加载失败时，页面会自动使用版式级文字 fallback；看板布局、逐日揭示、键盘操作和 Replay 事实均保持可用。清单中的 `relativePath` 仍须指向 `public/assets/` 下的本地文件；单文件构建会把它转换成受校验的 `data:image`。

素材注册表属于叙事展示层，不参与 `ReplayArtifact.factLayerHash`。替换插画或贴图不得改动 Replay 事实数据与 hash。
