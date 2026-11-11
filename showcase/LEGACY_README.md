# 北京浮生记 Arena Showcase

> PRIVATE SHOWCASE — DO NOT DISTRIBUTE

这是一个为单次私有展示建立的独立仓库。它只消费冻结比赛记录，不包含在线 Runner、Provider 调用、MCP、API Key 或重新比赛能力。

## 当前样本

- `gold-001`：已纳入。来源为 Completion-Assisted `run-001-prompt-v2-attempt-003`。
- `gold-002`：既有成品保留但当前冻结；不重新生成、不调整高光。后续仅在明确恢复时继续。

样本目录分为三层：

- `archive/`：完整私有归档，含 Runner 输出、旧浏览器证据和脱敏 raw exchanges；不得被 Web 构建读取。
- `samples/`：展示输入白名单，只保存经过字节校验的 Replay。
- `release/`：最终展示输出；不得包含 Trace、Report、Prompt、响应正文或 diagnostics。

## 环境

- Node.js `24.19.0`
- npm lockfile 安装
- Chromium（仅在浏览器验收时需要）

```bash
npm ci
npm --prefix web ci
npm test
```

生成首页与玩法介绍静态成品（输出到 `release/index.html` 和 `release/rules.html`，保留既有 Replay 单文件）：

```bash
npm run build:home-release
npm run test:home-release
```

首页成品可直接双击 `release/index.html`，并从“玩法介绍”进入 `release/rules.html`；也可通过本地静态服务器打开。发布脚本会把运行代码与 CSS
内联进 HTML，只额外复制五张首页/玩法图片与私有演示音乐；不会把素材提示词或 Replay 私有归档带入
`release/`。浏览器验收同时覆盖 `file://` 直接打开与本地 HTTP 两种方式。

生成 Gold1 / Gold2 的 Bench 分析页（终局成绩、速度、稳定性、Token 与逐请求轨迹）：

```bash
npm run build:bench-release
npm run test:bench-release
```

Bench 构建会先从冻结的 Replay、Run Report、Probe / Stability 与 waiver 生成脱敏汇总，再输出可直接双击的
`release/bench.html`。页面不复制 Trace、诊断、Prompt 或 raw request/response；Provider 未返回的 Token usage
保持缺失，成本保持 `unavailable`，不做估算。

生成 Gold1 的五条人工精选高光与单文件回放：

```bash
npm run replay:enrich -- \
  --input samples/gold-001/replay.json \
  --output curation/gold-001/replay-enrichment.json \
  --curated
npm run replay:build -- \
  --input samples/gold-001/replay.json \
  --enrichment curation/gold-001/replay-enrichment.json \
  --output release/replay.html
```

Gold2 当前冻结；以上流程不得隐式重建 `release/gold-002.html`。

Gold1 正式浏览器验收可以直接校验发布文件的确定性重建结果，不能回写 `archive/` 或 `samples/`：

```bash
npm run test:browser -- \
  --input samples/gold-001/replay.json \
  --enrichment curation/gold-001/replay-enrichment.json \
  --html release/replay.html \
  --report evidence/gold-001/browser-acceptance.json
```

## 明确排除

- 不重新运行或修复比赛。
- 不从 partial diagnostics 拼装 Replay。
- 不把两个来源目录中的旧 `4/14` 浏览器报告改写为通过。
- 不引入后端、数据库、云部署、遥测、CI、Git LFS 或多 schema 基建。
- 不公开仓库、素材、音乐、运行记录或展示包。
