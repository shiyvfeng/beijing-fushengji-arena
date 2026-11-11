# Arena 素材替换说明

本地插画通过逻辑 `assetId` 引用。可审计清单 [`public/assets/asset-manifest.json`](./public/assets/asset-manifest.json) 是素材路径、替代文本、比例与溯源信息的唯一数据源；[`src/asset-manifest.ts`](./src/asset-manifest.ts) 只负责导入、类型投影与运行时校验。组件不直接复制图片路径、URL 或来源信息。

当前确认的宏观视觉方向见 [`design/imagegen-shared-interview-stage-2026-08-20/README.md`](../design/imagegen-shared-interview-stage-2026-08-20/README.md)。参考图中的四位角色和 A/B/C/D 是历史概念内容；新版五模型 P0 的正式身份只显示 `Provider + Model`，不能把参考图的角色或策略身份烘焙进事实页面。

## 替换步骤

1. 将新的本地素材放入 `public/assets/illustrations/`，不要使用 CDN 或运行时远程 URL。
2. 只修改 `public/assets/asset-manifest.json` 中对应条目的 `relativePath`、`alt`、宽高比和来源记录；不要在 TypeScript 再复制一份路径。
3. 为生成或授权素材补同名记录文件，至少写明来源、生成日期或授权日期、Prompt（如适用）、Seed、SHA-256、人工修改和传播边界。
4. 执行 `npm --prefix web test`、`npm --prefix web run typecheck` 和 `npm --prefix web run build` 检查清单与静态站资源。
5. 使用有效 Replay 从仓库根目录构建正式单文件页面：

```bash
npm run arena:replay -- --input /absolute/path/to/replay.json

# 可选：显式指定输出文件
npm run arena:replay -- \
  --input /absolute/path/to/replay.json \
  --output /absolute/path/to/replay.html
```

`arena:replay` 要求显式 `--input`，会先校验 Replay schema 与 hash，再构建 Web、内联脚本/样式/本地图片，并检查远程依赖。正式构建器当前只接受五模型 `arena-schema-v4`，明确拒绝旧 schema 和四模型 Replay；历史产物的已有 HTML 保留，但不再保证可由新版构建器重建。

旧的 `ARENA_REPLAY_JSON=... npm run build` 和位置参数 `node scripts/build-replay.mjs <replay.json>` 不是当前公开入口，不应继续使用。底层脚本需要显式 `--input` 与 `--output`，正常使用应经根目录的 `arena:replay` 命令。

## Fallback 与事实边界

正式页面没有 `sampleReplay` 或 development Replay fallback。缺少 Replay、schema 不兼容、结构无效或 hash 不匹配时会直接停止展示。图片缺失或加载失败时，`AssetSlot` 可以显示版式级文字 fallback，但只能替代图片，不能伪造动作、采访、排名或其他 Replay 事实。

素材注册表属于展示层，不参与 Runner 的事实决策。替换插画或贴图不得修改 Replay 事实数据、事实 hash 或模型上下文。P0.5 Replay Enrichment 的高光、采访、奖项等派生内容也必须与事实 Replay 分层，不能通过素材替换写回 Runner。

当前项目只用于本地研究、线下展示和私有仓库协作；素材是否可对外传播仍以 manifest 和同名来源记录为准。
