# CLAUDE.md

本文件为在本仓库中工作的编码 Agent 提供当前事实和边界。不要把 legacy MCP 说明、四槽历史产物、已完成的五模型离线实现或尚未完成的真实 P0 验收混为一谈。

## 项目定位

北京浮生记 Arena 是一个 Direct Model 娱乐化 Benchmark：模型通过统一事实环境独立完成 40 天交易游戏，Runner 产出可审计 Replay、Trace、运行报告和单文件离线页面。

- **当前源码事实**：五模型 Direct Runner 已采用最低非关闭思考、`bounded-history-v1`、`bounded-retry-v1`、Probe → 十步 Stability → Match 门禁、`arena-schema-v4` Replay/Web 和 Report v5；Core/Web 离线闭环已通过。
- **待验收目标**：执行真实五 Provider Probe、至少 3 场新版 Direct 金样，并为每场保存正式自动浏览器报告；完成前不能称完整 P0 已验收。
- **历史证据**：2026-08-21 的 `run-001` 固定为四槽 v2，不计新版金样，也不回填。
- **P0.5**：独立 Replay Enrichment，默认使用与五个 Runner 配置分离的第六模型配置。
- **P1**：strict MCP。仓库原 MCP Server 仅为 legacy 入口。

产品范围、当前进度和已确认决策分别见：

- `docs/北京浮生记_Arena_娱乐化Benchmark产品与开发方案_v2.md`
- `docs/project-status.md`
- `docs/arena-direct.md`
- `docs/arena-direct-acceptance-2026-08-21.md`（仅历史四槽事实）

若文档与代码不一致，先报告“当前实现”“离线验证”和“真实验收”的差异，不得把离线 Fake Provider 结果描述成在线 Provider 或完整 P0 通过。

## 开发与验证

Arena 工具链要求 Node.js 22.18 或更高版本。

```bash
npm ci
npm --prefix web ci

npm run build
npm run test:arena-core
npm --prefix web test
npm --prefix web run typecheck

# 浏览器验收只使用 Playwright 当前支持的 Node 22/24/26
npm run arena:browser:install
npm run test:arena-browser:fixture
npm run test:arena-browser -- --input <run-directory>/replay.json --report <run-directory>/browser-acceptance.json

# 五组 Direct 配置检查；不联网
npm run arena:direct -- --check-config

# 恰好并行请求 A...E 各一次；会联网，只写 Probe 摘要
npm run arena:direct -- --output-dir <new-directory> --probe-providers

# Probe 通过后，每家连续完成十个有效动作；会联网，只写 Stability 摘要
npm run arena:direct -- --output-dir <same-directory> --stability-probe

# 同目录 Probe + Stability 门禁通过后启动五模型完整比赛
npm run arena:direct -- --output-dir <same-directory> --confirm-live-run

# 从五模型 arena-schema-v4 Replay 重建离线 HTML；不调用模型
npm run arena:replay -- --input <replay.json>
```

Scripted 相关命令只保留为内部确定性回归工具，不属于产品运行主流程、P0 验收或待办。离线 Fake Provider 测试通过不等于在线 Provider 通过。

## 当前架构

- `src/core/`：`GameEnvironment`、版本化规则/场景、坐标式 seeded RNG、不可变状态快照、事件和终局结算。
- `src/arena/`：Episode/Match Runner、Direct Driver、Provider adapters、Probe、Stability、Replay 聚合和运行报告。
- `src/arena-direct-cli.ts`：A...E 配置、Probe/Stability 双门禁、显式在线授权和事实产物写入。
- `web/src/`：正式 Replay 适配、日期切片、事实观众页和失败关闭。
- `scripts/build-arena-replay.mjs`：显式输入 Replay，校验 hash，构建单文件离线 HTML。
- `tests/core/`、`web/tests/`、`tests/browser/`：核心、Provider、Runner、Replay、Web 和 Playwright 双视口回归。
- `src/index.ts`、旧 `game-engine.ts` 等：legacy MCP 入口，不是当前 Arena 核心。

`GameEnvironment` 是 Direct Runner 的唯一事实核心。每个参赛者使用独立 Episode；公共市场共享 seed，个人随机按 slot 隔离。单个 Agent 技术失败不能阻塞其他 Agent，技术 DNF 不获得正式名次。

## 五模型 Runner 约束

- 五组配置的 `Provider + Model` 组合不得完全重复；同一 Provider 的不同 model 可以参赛。
- UI 只显示 `Provider + Model`，不显示 A/B/C/D、策略化名称或 persona。
- 所有模型使用 `neutral-v1`、无身份 Observation、`bounded-history-v1`、同一规则/预算/超时/输出上限和最低非关闭 `low`；DeepSeek 保持 `thinking=enabled`。
- 上下文固定为当前完整 Observation、最近 5 天确定性摘要、最近 8 条完整动作和更早历史聚合；不按 Provider 差异化裁剪，不含旧 Observation 或跨局事实。
- `bounded-retry-v1` 在 120 秒逻辑决策预算内将单次尝试限制为 60 秒；每决策最多 3 次，修复重试最多 2 次、瞬态重试最多 1 次，不重试 `context_limit`、鉴权/额度及其他终止错误。
- slot 仅为内部确定性标识；`cyclic-v1` 按 `slot = (entryIndex + rotationIndex) % 5` 轮换。
- Runner 只输出事实，不生成高光、采访、奖项、结局或解说。
- Day 40 只展示 DNF、正式排名和个人随机事件原始计数，不在 Runner 内生成幸运/倒霉结论。
- `arena-model-call-v2` 是请求、尝试序号、重试/恢复、延迟、Token、revision、sampling、故障归属和 action/retry/termination 关联的唯一聚合账本；不估算货币价格。
- Probe 必须保存 `arena-provider-probe-v3`；其后五家各顺序完成 10 个有效动作并保存 `arena-provider-stability-v1`。正式比赛只能消费同目录配置匹配且全部通过的两份摘要。
- 原始请求/响应只能由默认关闭的 `ARENA_SAVE_RAW_EXCHANGES` 写入 `dist/arena-diagnostics/<matchId>/<probe|stability|match>/`，不得进入比赛输出包或事实 hash。
- P0 至少 3 场新版五模型 Direct；游戏内失败和解释充分的 DNF 可作为真实结果，不强制全部存活至 Day 40。

## Runner 与 Replay Enrichment 隔离

任何叙事内容、采访、导演标签、奖项和历史轮次结论都不得进入 Runner 或后续轮次/比赛上下文。

P0.5 Replay Enrichment 只能读取已完成的事实 Replay：

- 通用生成使用与五个 Runner `Provider + Model` 组合均不重复的第六模型配置，不与 Runner 配置共用；
- 失败不得改变事实 Replay、要求重跑比赛或影响事实 hash；
- 赛后采访是唯一例外，可分别调用各选手原模型，但历史采访截面只提供该选手截至采访日已经发生的事实结果；
- 所有派生内容需要独立版本、来源和 hash。

## Web 与验收边界

- 正式页面没有 sample fallback；Replay 缺失、无效或 hash 不匹配时必须停止展示。
- Day 1～39 不得泄露终局排名或最终派生标签；Day 40 排名直接来自核心 `finalRanking`。
- 单文件 HTML 必须支持 `file://` 断网打开，不包含运行时远程依赖或模型调用。
- 自动浏览器工具品牌不强制；当前 Playwright 入口固定覆盖 `file://` 断网、双视口、日期边界、防剧透、DNF、失败关闭与键盘/焦点。Fixture 通过只证明框架，三场真实 Replay 必须分别保存正式报告。
- 视觉以 `design/imagegen-shared-interview-stage-2026-08-20/04-dark-actions-and-event.png` 的宏观骨架和深色语言为基准；该图只有四位历史概念角色，不能当作五模型事实 UI 或功能验收证据。

## 安全、产物与 Git

- API Key 只从本地环境读取，不进入日志、Replay、HTML、错误截图或提交。
- `.env`、`dist/` 和原始交换诊断目录必须保持 Git 忽略；`.npmignore` 还必须排除 `.env`、诊断与比赛产物。原始交换开关覆盖 Probe、Stability 与正式比赛，代码和 `.env.example` 均默认关闭；只有产品负责人明确授权时才能修改真实本地 `.env` 的非密钥字段，诊断文件不自动清理。
- 不覆盖既有比赛产物；每次真实比赛使用新目录。
- 当前交付仅限本地研究、线下展示和私有仓库协作，不部署或公开发布。
- 工作树可能包含用户未提交修改；只改任务明确授权的文件，不清理、重置或提交无关变更。
