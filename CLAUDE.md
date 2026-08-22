# CLAUDE.md

本文件为在本仓库中工作的编码 Agent 提供当前事实和边界。不要把 legacy MCP 说明、四槽历史产物或尚未实现的五模型目标混为一谈。

## 项目定位

北京浮生记 Arena 是一个 Direct Model 娱乐化 Benchmark：模型通过统一事实环境独立完成 40 天交易游戏，Runner 产出可审计 Replay、Trace、运行报告和单文件离线页面。

- **当前源码事实**：Direct CLI 固定 A/B/C/D 四槽；2026-08-21 的 `run-001` 是四模型历史验收。
- **修订后 P0 目标**：五个不同 `Provider + Model` 组合同场；事实 Runner + 五模型事实 Replay；至少 3 场新版 Direct 验收。
- **P0.5**：独立 Replay Enrichment，默认使用与五个 Runner 配置分离的第六模型配置。
- **P1**：strict MCP。仓库原 MCP Server 仅为 legacy 入口。

产品范围、当前进度和已确认决策分别见：

- `.doc/北京浮生记_Arena_娱乐化Benchmark产品与开发方案_v2.md`
- `docs/project-status.md`
- `docs/arena-direct.md`
- `docs/arena-direct-acceptance-2026-08-21.md`（仅历史四槽事实）

若文档与代码不一致，先报告“当前实现”和“目标契约”的差异，不得把目标描述成已实现。

## 开发与验证

Arena 工具链要求 Node.js 22.18 或更高版本。

```bash
npm ci
npm --prefix web ci

npm run build
npm run test:arena-core
npm --prefix web test
npm --prefix web run typecheck

# 当前四槽 Direct 配置检查；不联网
npm run arena:direct -- --check-config

# 当前恰好请求 A/B/C/D 各一次；会联网，不写比赛产物
npm run arena:direct -- --probe-providers

# 当前四槽完整比赛；每次都需显式授权并使用新目录
npm run arena:direct -- --output-dir <new-directory> --confirm-live-run

# 从既有四槽 Replay 重建离线 HTML；不调用模型
npm run arena:replay -- --input <replay.json>
```

Scripted 相关命令只保留为内部确定性回归工具，不属于产品运行主流程、P0 验收或待办。离线 Fake Provider 测试通过不等于在线 Provider 通过。

## 当前架构

- `src/core/`：`GameEnvironment`、版本化规则/场景、坐标式 seeded RNG、不可变状态快照、事件和终局结算。
- `src/arena/`：Episode/Match Runner、Direct Driver、Provider adapters、Probe、Replay 聚合和运行报告。
- `src/arena-direct-cli.ts`：当前 A/B/C/D 配置解析、显式在线授权和事实产物写入。
- `web/src/`：正式 Replay 适配、日期切片、事实观众页和失败关闭。
- `scripts/build-arena-replay.mjs`：显式输入 Replay，校验 hash，构建单文件离线 HTML。
- `tests/core/`、`web/tests/`：核心、Provider、Runner、Replay 和 Web 回归。
- `src/index.ts`、旧 `game-engine.ts` 等：legacy MCP 入口，不是当前 Arena 核心。

`GameEnvironment` 是 Direct Runner 的唯一事实核心。每个参赛者使用独立 Episode；公共市场共享 seed，个人随机按 slot 隔离。单个 Agent 技术失败不能阻塞其他 Agent，技术 DNF 不获得正式名次。

## 五模型 P0 目标约束

五槽代码尚未实现。实施时必须整体更新 CLI、Probe、Replay/Trace/Report、离线构建、Web、测试和文档，不能只增加一个环境变量。

- 五组配置的 `Provider + Model` 组合不得完全重复；同一 Provider 的不同 model 可以参赛。
- UI 只显示 `Provider + Model`，不显示 A/B/C/D、策略化名称或 persona。
- 所有模型使用相同版本化中性 Prompt、无身份观察、规则、预算、超时、输出 Token 上限和零自动重试。
- slot 仅为内部确定性标识；轮换保留为可配置选项。
- Runner 只输出事实，不生成高光、采访、奖项、结局或解说。
- DNF 保留原始随机事件计数，但不参与“最幸运/最倒霉”。
- 审计需补齐完整发送上下文 hash、model revision、sampling parameters、总墙钟、请求/action 关联、故障责任归属和输入/输出/总 Token；不估算货币价格。
- Probe 应保存脱敏摘要。原始请求/响应只能经显式开关写入独立、脱敏、Git 忽略的诊断目录。
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
- 自动浏览器工具品牌不强制，但可重复的自动浏览器验收是 P0 硬要求；同时保留 `file://` 断网人工/自动核验。
- 视觉以 `design/imagegen-shared-interview-stage-2026-08-20/04-dark-actions-and-event.png` 的宏观骨架和深色语言为基准；该图只有四位历史概念角色，不能当作五模型事实 UI 或功能验收证据。

## 安全、产物与 Git

- API Key 只从本地环境读取，不进入日志、Replay、HTML、错误截图或提交。
- `.env`、`dist/` 和原始交换诊断目录必须保持 Git 忽略。原始交换开关覆盖 Probe 与正式比赛，代码默认关闭、开发 `.env` 开启，当前开发阶段不做自动清理。
- 不覆盖既有比赛产物；每次真实比赛使用新目录。
- 当前交付仅限本地研究、线下展示和私有仓库协作，不部署或公开发布。
- 工作树可能包含用户未提交修改；只改任务明确授权的文件，不清理、重置或提交无关变更。
