# 北京浮生记 Arena 项目进度台账

> 台账状态：完成率改版已通过 Core/Web/Node 24 浏览器离线验证；等待本地基线与新策略付费门禁授权
>
> 首次建立：2026-08-21
>
> 最近审计：2026-08-22
>
> 产品方案基线：[《北京浮生记 Arena》娱乐化 Benchmark 产品与开发方案（v2.2，2026-08-22）](北京浮生记_Arena_娱乐化Benchmark产品与开发方案_v2.md)
>
> 本次边界：已实现五家最低非关闭思考、`bounded-history-v1`、`bounded-retry-v1`、十步 Stability 门禁和 v4/v5 审计契约；只执行离线 Fake Provider 测试，未发起新的在线 Provider 请求。

## 1. 台账用途与更新规则

本文件是项目唯一滚动进度台账。其他文档职责如下：

- 产品目标、P0/P0.5/P1/P2 和验收口径，以已修订的 v2.2 产品方案为准；
- [Direct 运行说明](arena-direct.md)记录当前可执行命令和技术边界；
- [2026-08-21 真实验收记录](arena-direct-acceptance-2026-08-21.md)只记录该次真实运行事实；
- [Direct-only 首版交付边界](arena-v0.md)记录历史四模型纵向切片；
- 本台账负责区分“已确认目标”和“当前实现”，并维护当前进度、问题、决策和下一步。

更新本台账时遵循：

1. 当前目标统一称为“修订后 Direct-only P0”，不再使用 M0/P0a 或“双口径”；
2. 区分“源码存在”“自动化已验证”“真实产物证明”“仅有日期验收记录”；
3. 区分“代码已实现并离线验证”和“真实 Provider/浏览器已经验收”，尤其不能把待办 1 完成写成完整 P0 已验收；
4. 技术 DNF、游戏内失败和平台故障分别记录，不用正常名次掩盖技术退出；
5. 每次真实比赛使用新的输出目录，旧 Replay 和报告不回填；
6. Runner 事实层与 Replay Enrichment 严格隔离，叙事结果不得写回 Runner 或进入后续比赛上下文；
7. 任何 P0.5/P1/P2 扩展必须先更新本台账中的范围决策。

状态标记：

| 标记 | 含义 |
| --- | --- |
| 已验证 | 当前源码和自动化、或可独立核对的本地产物支持该结论 |
| 已实现，待完整验收 | 主要代码存在，但未满足产品方案规定的全部场次、入口或验收矩阵 |
| 目标已确认，待实现 | 产品边界已经确认，但当前源码和产物尚未满足目标契约 |
| 文档记录 | 有日期验收记录，但当前没有独立、可重放的专门证据产物 |
| 后续阶段 | 已确认属于 P0.5、P1 或更后阶段，不进入当前 P0 验收 |
| 未实现 | 当前源码和正式产物中没有该能力 |
| 用户确认，未独立验证 | 产品负责人已说明外部状态已改变，但本次没有独立核验 |

## 2. 总体结论

### 2.1 单一范围状态

| 范围 | 当前状态 | 审计结论 |
| --- | --- | --- |
| 修订后 Direct-only P0 | 已实现，待完整验收 | 新策略真实金样 `0/3`；旧 `run-002` 完整产物和中止运行只作诊断，须重新通过 Probe v3、十步 Stability 和正式比赛 |
| 当前四模型纵向切片 | 已验证，作为历史证据保留 | 四组独立配置、四请求 Probe、真实比赛、Replay/Trace/Report、单文件 HTML 和 Day 1～40 事实回放已经串通；不等于新版五模型 P0 已完成 |
| P0.5 Replay Enrichment | 后续阶段 | 使用事实 Replay 生成程序化高光、采访、奖项、结局和可选 LLM 文案；配置与五组 Runner `Provider + model` 均不重复的第 6 个 Replay 娱乐加工模型，但赛后采访例外调用各选手原模型 |
| P1 strict MCP | 后续阶段 | `StrictMcpEpisodePort` 仅保留接口占位；当前不开发、不验收，不纳入 P0 完成声明 |
| 本地与私有协作 | 用户确认，未独立验证 | 产品只做本地研究和线下展示；产品负责人已在网页端将仓库改为私有，本次未独立验证远端可见性 |

Scripted 不再属于产品范围、P0 金样或产品待办；现有 Scripted 能力只作为内部确定性回归工具保留。

### 2.2 是否跑偏

技术地基没有根本跑偏，以下现有能力可以继续复用于修订后 P0：

- Direct 是自动比赛的唯一 P0 入口；
- 当前五模型实现使用相同 `neutral-v1`、无身份 Observation 和 `bounded-history-v1`；
- 公共市场共享 seed，个人随机按槽位隔离；
- GameEnvironment、结构化事件、状态 diff、证据 ID 和 hash 构成事实链；
- 单 Agent 技术失败不阻塞其他 Agent，技术 DNF 不伪造正式名次；
- Replay 和单文件 HTML 可离线重建，正式页面缺 Replay 时失败关闭；
- 页面使用统一日期切片，第 40 天前不展示正式排名；
- 离线页面不重新调用 Runner，也不改变事实 Replay。

五模型契约现为：恰好五个不同 `Provider + model`、`cyclic-v1`、五家显式 `low`、`bounded-history-v1`、固定 120 秒逻辑决策预算内的 `bounded-retry-v1`、逐请求 v2 账本、Probe v3、十步 Stability v1、Replay v4 和 Report v5。此前最高 effort + 全历史 + 零重试的 `run-002` 已验证旧事实链，也暴露了上下文增长、输出截断和瞬态失败，但策略改变后不能计入新样本；当前正式计数回到 `0/3`。

### 2.3 已确认视觉方向

- 当前唯一视觉基准为 [`04-dark-actions-and-event.png`](../design/imagegen-shared-interview-stage-2026-08-20/04-dark-actions-and-event.png)，对应说明见[当前视觉方向文档](../design/imagegen-shared-interview-stage-2026-08-20/README.md)。
- `01-shared-ai-interview-stage.png`、`02-light-shared-ai-interview-stage.png` 和 `03-dark-prices-and-ticker.png` 仅保留为历史探索，不再作为并列候选。
- 本次确认的是深色视觉语言、左/中/右/下页面骨架和信息层级；采访、预测、高光、奖项和结局已确认属于 P0.5 Replay Enrichment，而不是 Runner 或 P0 事实层。
- 后续前端即使隐藏尚未启用的叙事模块，也应保留已确认的宏观布局和视觉语言，不应再次退化为与该方向无关的通用数据看板。

## 3. 当前证据快照

### 3.1 待办 1～2 离线验证

| 检查 | 结果 | 证据边界 |
| --- | --- | --- |
| Core build 与测试 | 92/92 通过 | 覆盖有界上下文、动作修复、超时恢复、重试耗尽、`context_limit` 不重试和三段 CLI 门禁；未调用在线模型 |
| Web 测试 | 11/11 通过 | 执行 `npm --prefix web test` |
| Web typecheck | 通过 | 执行 `npm --prefix web run typecheck` |
| 五 Fake Provider Probe + Stability + Match | 通过 | Probe 5 次、Stability 5×10、同目录双摘要门禁、五 Trace、v4 Replay、v5 Report 和单文件 HTML 完整闭环 |
| Replay 确定性与敏感信息 | 通过 | 同一 Replay 重建字节一致；正式产物与诊断文件执行凭据扫描 |
| 自动浏览器 Fixture | 14/14 通过 | Playwright 1.62.1、Chromium 151、1366×768 与 1920×1080；覆盖 Day 1/39/40、防剧透、DNF、hash、失败关闭、`file://` 离线和键盘/焦点 |
| 机器可读验收报告 | 已验证 | `arena-browser-acceptance-v1` 记录输入 hash、HTML SHA-256、Node/Playwright/Chromium、双视口检查和失败原因 |

旧策略 `run-002-attempt-02-pre-live-diagnostics` 共 128 请求、123 成功/5 失败、123 个有效动作，完整产物与浏览器 14/14；随后开启原始交换的运行在 84 个已完成 exchange 后人工停止。诊断显示 DeepSeek 输出截断为空、OpenAI/Qwen/Kimi 本地 120 秒中止，以及 Anthropic 输入上下文持续增长。详细边界见 [`run-002` 诊断与重置记录](arena-direct-acceptance-run-002.md)。这些证据不计新策略金样。

### 3.2 真实 `run-001` 事实

| 槽位 | Provider / model | 状态 | 正式名次 | 请求成功/总数 | 有效/无效动作 | Total Token |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| A | OpenAI / `gpt-5.6-sol` | Day 40 完赛 | 1 | 98/98 | 98/0 | 613135 |
| B | Anthropic / `claude-opus-5` | Day 40 完赛 | 2 | 61/61 | 61/0 | 85441 |
| C | DeepSeek / `deepseek-v4-pro` | Day 35 游戏内死亡 | 3 | 69/69 | 61/8 | 102716 |
| D | Kimi / `kimi-k3` | Day 1 `model_timeout` 技术 DNF | — | 2/3 | 2/0 | 4183 |

全场 231 次请求、230 次成功、1 次超时；222 个有效动作、8 个无效动作；总计 805475 Token。该结果证明当时四槽实现的故障隔离和事实产物闭环，不证明四个模型都能稳定完成 40 天，也不构成模型能力 Benchmark。由于修订后 P0 要求五个不同 Provider + model 同场，`run-001` 只保留为历史证据，不计入新版三场五模型金样。

### 3.3 证据等级限制

- 最终四家 Provider Probe 全通过的数字记录在[日期验收文档](arena-direct-acceptance-2026-08-21.md#四请求-provider-probe)，但 Probe 设计为只输出 stdout、不写正式产物；当前 `dist/arena-diagnostics/` 中没有一份最终 all-pass 四家 Probe 文件。因此它属于“文档记录”，不是可由正式比赛产物独立重放的证据。
- 日期验收记录声明同一 Replay 重复生成字节一致 HTML，并完成 `file://`、内置浏览器和 Chrome 的 Day 1/39/40 验收；本次审计未重新执行这些 GUI 操作。
- Replay 能证明记录的 Provider/model/adapter 身份和请求结果，但单靠 Replay 不能证明 Adapter 一定连接真实外部服务而不是测试替身；Runner 自身也明确披露此限制。
- 新 CLI 已强制五套连续配置、五个唯一 `Provider + model` 和 Probe + Stability 双门禁；旧运行不证明新策略下未来凭据、额度、模型或端点持续可用。

## 4. 对照修订后 Direct-only P0 实施阶段

| 实施阶段 | 当前状态 | 已有证据 | 尚缺内容 |
| --- | --- | --- | --- |
| 阶段 0：产品与文档收口 | 已完成 | v2.2 产品方案、台账、README、Direct/历史验收、Web/视觉和 Agent 说明 Markdown 已形成单一口径 | Arena 主包 name/main/bin/engine 已同步，legacy MCP bin 保留 |
| 阶段 1：确定性核心环境 | 基本完成 | `GameEnvironment`、坐标式 seeded RNG、公共/个人随机流、不可变快照、diff、稳定事件 ID、统一估值与幂等终局均有代码和测试 | 当前 P0 不要求扩展 information/NPC 随机流；现有 Scripted 仅保留为内部确定性回归工具 |
| 阶段 2：五模型 Direct Runner | 已实现，真实新样本 0 场 | 最低非关闭思考、Probe + Stability 门禁、120 秒逻辑预算和故障隔离已离线验证 | 取得授权后重新 Probe 与十步 Stability |
| 阶段 3：上下文与审计 | 已实现，真实新样本 0 场 | `bounded-history-v1`、`bounded-retry-v1`、model-call v2、重试/恢复统计已通过单测 | 用真实 Stability 复核延迟、Token 和恢复率 |
| 阶段 4：事实 Replay 与报告 | 已实现，真实新样本 0 场 | Replay v4、Report v5、Probe v3、Stability v1 与确定性重建已离线通过 | 新策略正式比赛后生成真实产物 |
| 阶段 5：事实观众页与自动验收 | 框架已验证，正式报告 0/3 | Web 11/11、Node 24 双视口 Fixture 14/14；旧策略报告只作诊断 | 每场新金样生成正式报告 |
| 阶段 6：三场真实金样 | 0/3 | `run-001` 与所有旧 `run-002` 均不符合新策略契约 | 依次完成新 `run-002`、`run-003`、`run-004` |
| 阶段 7：P0.5 Replay Enrichment | 后续阶段 | 已确认事实层与娱乐层隔离原则 | 事实层稳定后，先做程序化高光，再做采访、奖项、结局和可选 LLM 文案；通用生成配置与五组 Runner 均不重复的第 6 个 Replay 娱乐加工模型 |
| 阶段 8：P1 strict MCP | 后续阶段 | 仅有接口占位和禁止伪装实现的守卫 | P0 不开发、不验收；进入 P1 后另立计划 |

## 5. 对照修订后 P0 模块

| P0 模块 | 状态 | 审计判断 |
| --- | --- | --- |
| 确定性核心环境 | 已验证 | 当前最完整的模块，可以继续作为五模型事实核心 |
| 五模型 Direct Match Runner | 已实现，真实新样本 0 场 | 五个唯一 Provider + model、五个隔离 Episode、双摘要门禁和故障隔离已离线验证 |
| 公平决策边界 | 已实现，真实新样本 0 场 | 中性 Prompt、无身份 Observation、统一 `low`、预算、重试和 `cyclic-v1` |
| 结构化事件日志 | 已验证 | action、before、after、diff、随机流、证据 ID 与 `modelCallId` 一一关联 |
| 上下文契约与审计 | 已验证 | 有界窗口、确定性聚合、双 hash、attempt/retry/recovery、revision、sampling、总墙钟、故障域和 Token 账本可重算 |
| 事实 Replay | 已验证 | v4 强校验、五 Trace、个人随机原始计数与确定性重建完成；正式构建器拒绝旧 schema/四模型 |
| 运行报告与诊断 | 已验证 | Probe v3、Stability v1、Report v5、model-call v2 和三阶段脱敏原始交换均有离线测试 |
| 事实观众页 | 框架已验证，正式报告 0/3 | v4 Web 11/11；新策略正式 Replay 尚未生成 |
| 离线交付 | 已验证 | 显式输入、失败保留 JSON、无远程依赖、可重复构建 |
| 故障边界 | 基本完成 | 单 Agent 技术失败不影响其他 Agent；游戏内死亡和技术 DNF 都是需如实展示的比赛事实，不是 P0 自动失败门槛 |
| 自动浏览器验收 | 框架已验证，正式报告 0/3 | 新策略 Node 24.19.0 双视口 Fixture 14/14；真实报告须随新金样生成 |
| 三场真实金样 | 0/3 | 旧策略与四模型产物仅作诊断或历史证据 |

以下能力不属于 P0：Scripted 产品入口与金样、strict MCP、程序化高光、采访、奖项、结局、模型生成解说。Scripted 只保留为内部测试工具；其余分别进入 P0.5 或 P1。

## 6. 当前未完成项与风险

| ID | 优先级 | 未完成项 | 影响与当前处理 |
| --- | --- | --- | --- |
| AUD-005 | 高 | 新策略五模型正式计数为 0/3 | 先完成本地基线；再经授权执行 Probe、Stability 和正式比赛 |
| AUD-006 | 高 | `run-001` 的超时延迟统计不完整 | Kimi `samples=3`，旧报告延迟只覆盖前两次请求；保留旧事实，不回填，后续新版比赛验证修复后报告 |
| AUD-007 | 高 | 新策略正式自动浏览器报告为 0/3 | 旧报告保留作诊断；三场新策略各自生成报告 |
| AUD-010 | 已关闭 | Arena 主体的 Git 提交边界已收口 | 离线门禁通过后以本地基线提交本轮显式思考等级变更；不推送远端，两个无关 `.DS_Store` 不纳入提交 |
| AUD-011 | 后续 | P0.5 Replay Enrichment 尚未实现 | 不阻塞 P0；事实层稳定后按“程序化高光 → 采访/奖项 → 可选 LLM”顺序启动 |

## 7. 文档收口状态

本轮同步 v2.2 产品方案、台账、README、`CLAUDE.md`、Direct 运行说明、`run-002` 诊断记录与 Web 边界。历史比赛数字和 hash 不追溯改写；完整旧产物保留在独立诊断目录，标准 `run-002` 不伪装为已完成。

产品方案文件名仍保留 `v2`，正文版本和引用统一以“v2.2 / 2026-08-22”为准。`package.json` 已切换为 Arena 主包、Node `>=22.18.0` 和默认 Arena bin，同时保留 `beijing-fushengji-mcp` legacy bin 与 `start:mcp`。

## 8. 已确认产品决策

| ID | 已确认决策 |
| --- | --- |
| DEC-001 | 正式修订产品方案；当前目标统一称为“修订后 Direct-only P0”，不再保留 M0/P0a 或双口径。 |
| DEC-002 | strict MCP 移入 P1；现有接口占位和禁止伪装已实现的守卫可保持代码现状，但不属于 P0 范围或验收。 |
| DEC-003 | Runner 只生成事实 Trace、Report 和 Replay；所有高光、采访、奖项、结局和 LLM 文案由独立 Replay Enrichment 根据事实 Replay 生成，不得改变事实层。 |
| DEC-004 | P0 只验收 Direct；至少完成 3 场符合新版五模型契约的真实金样。Scripted 从产品范围、验收和产品待办删除，仅保留内部确定性回归工具。 |
| DEC-005 | 观众页只显示 Provider + Model，不显示 A/B/C/D、策略化展示名或 persona。内部 slot 可以存在，但不作为观众身份。 |
| DEC-006 | Runner 只记录个人随机事件事实；“最幸运/最倒霉”只在 P0.5 生成，技术 DNF 不参与该标签。 |
| DEC-007 | 保留模型与内部 slot 的可配置轮换能力，用于后续多场公平控制。 |
| DEC-008 | P0 补齐版本化上下文策略、完整发送上下文 hash、model revision、sampling parameters、总墙钟、请求-action 关联和故障责任归属；成本仅统计输入/输出 Token，不计算价格。 |
| DEC-009 | 新版真实比赛如实记录游戏死亡和技术 DNF，先人工判断原因；不要求零技术 DNF，也不要求所有模型存活至 Day 40。 |
| DEC-010 | 交付范围为本地研究、线下展示和私有仓库协作。产品负责人已说明网页端仓库已改为私有，本次未独立验证。 |
| DEC-011 | ECharts、Vitest、CSS Modules、Reducer/Context 都是推荐方案，不为形式强制重构；浏览器工具品牌不限，但“可重复的自动浏览器验收”是完整 P0 硬要求。 |
| DEC-012 | 一场 Runner 比赛需要 5 组不同 Provider + model 配置；Replay Enrichment 另设与这五组组合均不重复的第 6 个娱乐加工模型配置。 |
| DEC-013 | 正式验收保存脱敏 Probe 结果摘要；Replay 只保存结构化事实；同一显式开关覆盖 Probe 和正式比赛原始交换，代码和 `.env.example` 默认关闭，正文写入独立、脱敏、Git 忽略且不自动清理的诊断目录；默认不修改真实 `.env`，产品负责人明确要求的本机非密钥配置更新除外。 |
| DEC-014 | 五家思考等级统一降至最低非关闭 `low`；以 `bounded-history-v1` 替代全历史，以 `bounded-retry-v1` 在固定逻辑预算内恢复可修复/瞬态失败；正式比赛增加十步 Stability 门禁。策略改变后旧样本全部降为诊断证据，三场计数重新从 0/3 开始。 |

Replay Enrichment 的隔离补充约束：

- 独立第 6 个模型的 `Provider + model` 不得与五组 Runner 中任何组合重复，只负责基于既有事实 Replay 的娱乐加工，不参加 Runner 比赛；
- 赛后采访是唯一例外：采访分别调用各选手原模型，只向其提供该选手截至该采访日已经发生的事实结果；即使整场比赛已结束，也不得使用采访日之后的未来事实；
- 采访、叙事、高光、奖项、结局和任何前轮比赛结果，都不得写回当前 Runner，也不得进入后续轮次 Runner 的模型上下文；
- P0.5 产物失败时，P0 事实 Replay、排名、报告和离线查看能力仍应完整有效。

## 9. 当前阶段边界

- 当前 P0 只处理五模型 Direct Runner、事实 Replay/报告、事实观众页、审计诊断和三场真实金样。
- P0.5 才启动 Replay Enrichment，优先程序化、证据驱动的高光与导演筛选的关键事件对比，再加入采访、奖项、结局和可选 LLM 文案。
- strict MCP 属于 P1，不进入当前实现或验收。
- Scripted 只作为内部回归工具存在，不再出现在产品完成标准和真实金样数量中。
- 不把公开发布、零 DNF、全员存活、价格成本估算或为技术选型而重构列为当前待办。
- 主持人控制台、私人备课、第二屏、手机遥控、幽灵线和完整反事实模拟继续不属于产品需求。

## 10. 后续待办

1. **完成新策略本地基线**：敏感信息扫描、`git diff --check` 和本地提交；不推送。Node 24 双视口 Fixture 已 14/14 通过。
2. **重新执行 `run-002` 门禁**：另行授权后先 Probe v3，再单独授权十步 Stability；任一步失败均不启动正式比赛。
3. **完成三场新策略金样**：`run-002`、`run-003`、`run-004` 使用同一五模型组合、Prompt、120 秒逻辑上限、4096 输出上限和恢复策略，只改变 seed/rotation；每场保存正式浏览器报告。
4. **事实层稳定后启动 P0.5 Replay Enrichment**：先实现程序化高光和导演筛选的关键事件对比，再加入赛后采访、奖项、结局和可选 LLM 文案；通用生成启用与五组 Runner 均不重复的第 6 个加工模型，采访原模型例外建立历史截面与不回写 Runner 的隔离测试。

## 11. 变更记录

| 日期 | 记录 |
| --- | --- |
| 2026-08-22 | 产品负责人确认完成率改版：五家 effort 降至 `low`，引入 `bounded-history-v1`、固定 120 秒逻辑预算内的 `bounded-retry-v1` 和十步 Stability 门禁；Probe/model-call/Replay/Report 升级为 v3/v2/v4/v5。Core 92/92、Web 11/11、typecheck 与 Node 24 双视口 Fixture 14/14 已通过，未调用在线 Provider；新策略金样重置为 0/3 |
| 2026-08-22 | OpenAI/Anthropic 更换供应商后旧策略 `run-002` 完整诊断：128 请求、123 成功/5 失败、123 个有效动作；五 Trace、Replay v3、Report v4、HTML 与浏览器 14/14。后续策略改版后降为诊断证据，不计金样 |
| 2026-08-22 | 首次 `run-002` 尝试因网络稳定性疑问被要求重跑；旧产物保留为 `run-002-attempt-01-network-suspected` 诊断证据，不参与当前金样计数 |
| 2026-08-22 | 显式最高 effort 的 `run-002` 五请求 Probe 达到 4/5，DeepSeek 在 60.004 秒超时；DeepSeek 单请求 300 秒诊断在 54.394 秒返回有效动作，Token 为 1441/2743/4184。产品负责人将新版金样正式单次上限由 60 秒调整为 120 秒；默认总墙钟相应按 160×120 秒变为 19200000 ms，须按新指纹重新 Probe |
| 2026-08-22 | 在正式比赛前为五组 Runner 增加必填 `REASONING_EFFORT`：OpenAI/Anthropic/DeepSeek/Kimi 配置 `max`，Qwen 配置 `xhigh`，DeepSeek 改为 `enabled + max`；三类 Adapter 分别发送原生 effort 字段，配置指纹、Probe/Trace/Replay/Report 与 Web 门禁升级为 `provider-explicit-effort-audited-v2`；旧 `run-002` Probe 降为诊断证据并须重跑 |
| 2026-08-22 | 实现待办 2：加入 Playwright 1.62.1 与 Chromium 双视口验收、Fixture/正式 Replay 两类入口、`arena-browser-acceptance-v1` 报告、重复构建/现有 HTML hash 核对和必要焦点/reduced-motion 修正；确定性五模型 v3 Fixture 14/14 通过，`run-001` v2 与已知测试替身标记均被正式入口拒绝；未调用真实 Provider，三场正式报告仍为 0/3 |
| 2026-08-22 | 实现待办 1：五模型 Direct Runner、全历史上下文、逐请求账本、Probe 门禁、审计诊断、Replay v3/Report v4、五模型事实页面和 Arena 主包元数据；完成 Fake Provider 离线闭环，未调用真实 Provider、未执行三场金样或自动浏览器验收 |
| 2026-08-22 | 根据产品负责人对 `DEC-001`～`DEC-013` 及后续澄清的确认，将目标统一为修订后 Direct-only P0：五个不同 Provider + model 同场、独立第 6 个 Replay 娱乐加工模型、三场新版真实金样；Scripted 仅保留内部回归，strict MCP 移 P1，叙事移 P0.5；完成相关 Markdown 收口并形成四步后续待办，未修改代码、配置或比赛产物 |
| 2026-08-21 | 确认 `04-dark-actions-and-event.png` 为唯一当前视觉方向；其他三版转为历史探索；该确认不自动改变叙事功能范围 |
| 2026-08-21 | 首次建立台账；完整对照 v2.1 方案、当前源码、84/84 Core、11/11 Web、typecheck、`run-001` 产物和现有文档；登记 16 项审计发现和 13 项待确认决策；未修改代码或比赛产物 |
