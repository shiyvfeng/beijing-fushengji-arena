# 《北京浮生记 Arena》娱乐化 Benchmark 产品与开发方案（v2.2）

> 修订说明（2026-08-22）：本版重新冻结 P0 为五个不同 `Provider + model` 的五模型同场 Direct Benchmark。P0 Runner 只生成事实性 Replay、Trace 与 Run Report；程序化高光、采访、奖项、结局和娱乐解说统一移入 P0.5 的独立 Replay Enrichment。strict MCP 移入 P1；Scripted 不再属于产品范围或验收，只保留为内部确定性回归工具。文件名暂保留 `v2`，正文版本以 v2.2 为准。

已确认且后续默认不再反复讨论的产品决策：

- 页面永远只有一套公开观众视图，任何人拿到 Replay 都可以逐日查看；
- P0 以人工逐日查看事实回放和线下真人口头解说为先，自动回放进入 P1；
- 镜像投屏时电脑与大屏看到同一画面；
- 允许比喻、调侃和带保留措辞的主观解读，但不把动机与因果写成事实；
- 删除幽灵线，不实现完整反事实收益模拟；
- P0 只采用 Direct Model：五组独立配置必须对应五个不重复的 `Provider + model` 组合；
- 五个模型使用相同的版本化中性 Prompt、无身份 Observation、规则、seed、动作预算、超时和输出上限；
- UI 只展示 `Provider + model`，不展示 A/B/C/D/E、策略化名称或预设人格；
- P0.5 Replay Enrichment 与 Runner 进程、配置、产物和 hash 边界隔离；通用生成使用独立第六模型配置，采访例外使用各选手原模型做赛后独立调用；
- strict MCP 属于 P1；Scripted 仅作为内部确定性回归工具，不是产品入口、金样或交付能力。

## 1. 文档目标

本方案用于将现有《北京浮生记》项目改造成可观看、可回放、可分享的多 Agent 生存竞技产品。

产品以 40 天城市生存与倒货经营为核心，让多个 Agent 在相同外部环境、相同初始条件下独立决策，通过资产变化、债务压力、健康风险、市场事件和工具行为形成可对比的比赛过程。

P0 开发目标不是扩充大量玩法，而是完成以下事实闭环：

1. 五个不同 `Provider + model` 的 Agent 在同一世界线中独立完成一局游戏；
2. 全程生成可审计的结构化事件日志；
3. 输出可验证的 `replay.json`、Episode Trace、`run-report.json` 和单文件 `replay.html`；
4. 通过前端按第 1～40 天呈现真实动作、状态、排名、DNF 和终局；
5. 补齐完整发送上下文 hash、model revision、采样参数、总墙钟、请求与 action 关联、故障归属和输入/输出 Token；
6. 保证任何 Replay Enrichment 都不进入 Agent 决策上下文、不回写事实产物，也不改变 Runner 结果或事实 hash。

P0.5 再建立独立 Replay Enrichment：它只消费已经完成并验证的事实 Replay，生成程序化高光、采访、奖项、结局和娱乐解说等可删除的派生内容。

---

## 2. 产品定位

### 2.1 一句话定位

> 五个 AI 带着同样的钱和债来到北京，在同一条 40 天世界线里倒货、还债、保命，看谁发财、谁破产、谁能活着上岸。

### 2.2 核心观看价值

- 同一个市场变化下，不同 Agent 作出不同决策；
- Agent 的实际行动与结果形成可审计的差异；
- 资产、债务、健康和排名在长期决策中持续变化；
- 成功、游戏内死亡和技术 DNF 都被如实保留；
- P0.5 可以在不改变事实层的前提下，把每局加工成高光、采访、奖项和结局。

### 2.3 产品形态

默认采用“后台完整运行，前端按日揭示”的形式：

1. 后台先完成所有 Agent 的完整 episode；
2. 生成统一、确定且可离线读取的 Replay 数据；
3. 生成独立 Trace、Run Report、Probe 摘要与可选的脱敏原始交换诊断；
4. 前端以全局日期游标控制事实信息的可见范围；
5. 任何观看者都可以从第 1 天逐日查看或直接跳到指定日期；
6. 第 40 天后显示由核心统一结算得到的正式终局。

P0.5 可在 Runner 完全结束后单独执行 Replay Enrichment。通用生成使用不与五个参赛配置共用的第六模型；采访则在赛后分别调用对应选手的原模型，只提供该选手已经发生的事实结果。Enrichment 失败不影响 P0 产物，且生成内容不得写回 `replay.json` 的事实层。

P0 优先服务线下镜像投屏与真人口头解说，但页面本身不区分演示者和观众，也不依赖演示者才能理解。展示端必须全本地运行，现场不调用模型、不依赖互联网。

P0 不强制回放时长。自动播放、自动节奏控制和无人值守观看模式不在 P0；未来若恢复，建议控制在：

- 完整回放：8～12 分钟；
- 精华回放：60～90 秒；
- 单 Agent 赛后故事：20～40 秒；
- 分享卡：一屏完成阅读。

### 2.4 P0 展示边界与明确非目标

P0 只提供一套面向所有人的观众界面。以下内容不属于本项目需求，后续也不应以“现场模式”为理由重新引入：

- 主持人控制台或演示者专属界面；
- 备课工作流、私人收藏、私人备注或手动节目单；
- 主持人与观众的权限区分；
- 双屏同步、扩展屏控制或手机遥控器；
- 只有演示者可见的终局、高光或未揭示数据。

真人可以像任何观看者一样拖动日期游标或点击已揭示内容。若真人事先知道重点日期，可以直接跳转，但产品不保存这类个人准备信息。

---

## 3. 核心设计原则

### 3.1 Runner 事实层与 Replay Enrichment 完全分离

Agent 决策只基于游戏规则、当前状态、可获得的市场信息和已经发生的事件。

以下内容不得进入 Agent 决策上下文：

- 预设章节名称；
- “豪赌期”“债务危机期”“最后冲刺”等策略暗示；
- 其他参赛者的状态、排名、选择或结果；
- 导演系统生成的解说与高光标签；
- 未来事件的发生时间、事件池配置或概率；
- 赛后奖项和结局规则中的策略提示；
- 观众评论与前端展示文本。

P0 `replay.json` 只保存 Runner 产生的结构化事实。章节、解说、人物标签、采访、奖项和节目节奏属于 P0.5 的独立 Enrichment 产物，不得回写事实 Replay、Trace 或 Run Report，不得改变事实 hash，也不得触发重新运行比赛。

下一轮 Runner 必须从全新、无跨局记忆的上下文开始，不能读取任何前轮结果、采访、解说、高光、奖项、结局或 Enrichment 缓存。

### 3.2 章节解释结果，不引导行为

游戏运行期间不设置对 Agent 可见的剧情章节。

P0 前端可以按固定时间切分中性日期单元，但不得将播放单元命名为带有策略倾向的阶段。P0.5 可以在整局完成后，由 Enrichment 根据真实事件动态生成幕标题。

### 3.3 同一世界线，独立人生

所有 Agent 使用：

- 相同 scenario；
- 相同 seed；
- 相同初始资金、债务、健康和规则；
- 相同公共市场环境和公共世界事件；
- 相同工具接口与资源限制。

每个 Agent 运行在独立游戏副本中。一个 Agent 的买卖不会直接改变其他 Agent 的库存和现金。

由个人行为触发的事件可以不同，例如：

- 持有高风险商品后遭遇没收；
- 健康过低后触发住院；
- 债务比例过高后触发催债；
- 现金携带过多后遭遇损失。

### 3.4 失败必须留下事实

破产、死亡、工具失误、错误判断、卖飞和追涨都必须进入事实日志。P0.5 可以据此生成高光、奖项与人物结局。

P0 中每个完成比赛或中途出局的 Agent 都必须获得：

- 一段事实化赛后总结；
- 明确的完成、游戏内死亡或技术 DNF 状态；
- 可回看的完整动作、状态和证据链。

奖项、结局、关键转折和“最幸运/最倒霉”等价值判断标签统一属于 P0.5。技术 DNF 不参与幸运或倒霉评选。

### 3.5 不展示内部思维链

P0 前端仅展示：

- 工具动作及其结果；
- 程序计算得到的状态变化；
- Provider、模型、运行状态和审计字段。

P0.5 可以展示赛后采访和由事实生成的解说，但仍不得展示模型内部推理文本。

不得展示模型内部推理文本、隐藏 scratchpad 或完整思维过程。

### 3.6 所有事实可回溯

事实页面以及 P0.5 解说中的日期、价格、数量、盈亏、排名、债务、健康和事件必须来自结构化日志。

每条 P0.5 解说、高光、采访对账、奖项和结局都应保存对应的 `eventId` 或 `evidenceEventIds`，并标明来源 Replay hash。

### 3.7 单一观众视图与逐日揭示

前端只有一套公开视图，镜像投屏与个人浏览呈现相同内容。

任何时刻的页面信息由 `visibleThroughDay` 决定。所有面板、弹窗、图表、悬浮提示、事件关联字段和导出内容，只能读取该日期及以前的数据。终局排名在第 40 天之前不得通过任何交互路径泄露；若加载 P0.5 Enrichment，奖项和结局同样受此边界约束。

该约束只属于 Replay 与展示层，不改变 Agent 决策环境。

---

## 4. 标准比赛规则

| 项目 | 标准配置 |
|---|---|
| 参赛者数量 | 固定 5 个 Agent |
| 游戏长度 | 40 天 |
| 外部环境 | 同一 scenario、同一 seed |
| Agent 状态 | 相互独立 |
| 初始条件 | 完全一致 |
| 核心目标 | 存活、偿债、提高最终净资产 |
| 运行方式 | 后台并行或受控并发运行 |
| 展示方式 | 完整运行后生成 Replay |
| 工具预算 | 按比赛配置统一限制 |
| 失败隔离 | 单个 Agent 卡死不影响其他 Agent |
| 最终结算 | 由引擎自动完成 |

### 4.1 最终结算

终局由引擎统一执行，至少包括：

```text
最终净资产 =
现金
+ 存款
+ 库存终局清算价值
- 未偿债务
- 已产生但未结算的费用
```

库存终局清算不得使用“第 40 天全城最高价”，也不得使用某个 Agent 最后一次看到的局部价格。每个 scenario 必须定义统一的终局收购规则：

```text
库存终局清算价值 =
数量
× 第 40 天统一终局收购价
× 商品流动性折扣系数
```

- 终局收购价由 `scenario + seed + day 40 + commodityId` 确定；
- 同一场比赛的所有 Agent 使用完全相同的终局收购价；
- 价格生成规则和流动性系数属于 Agent 可见规则；
- 第 40 天之前不得向 Agent 提供具体未来收购价；
- 低流动性或高风险商品可配置 0.7～0.9 的折扣，普通商品默认为 1.0；
- 终局只结算一次，结算后锁定状态。

P0 标准 scenario 采用最简单的可审计实现：市场引擎每天按 `scenario + seed + day + commodityId` 生成一份全场统一的 `publicReferencePrice`，并叠加当天已经生效的公共市场事件；第 40 天的该参考价即为终局收购价。地点交易价可以在参考价上增加局部修正，但不得反过来改变终局收购价。若某商品当天局部缺货，参考价仍必须存在且大于 0。

比赛过程中的展示净资产统一定义为：

```text
展示净资产 =
现金 + 存款 + 按当日统一估值价计算的库存价值
- 债务 - 已产生未结费用
```

统一估值价只用于排名、曲线与高光计算，不等同于 Agent 当前所在地可交易价格。

终局后禁止继续交易、移动、借贷、存取款或重复结算。

### 4.2 同步方式

Agent 不需要在同一个实时回合中等待彼此。

后台分别运行完整 episode，最终按游戏日对齐：

```text
第 1 天：汇总五个 Agent 的当天行为和结果
第 2 天：汇总五个 Agent 的当天行为和结果
……
第 40 天：统一展示终局结果
```

如同一游戏日内存在多个动作，Replay 按动作发生顺序记录，并由导演系统选择展示粒度。

### 4.3 出局、完赛与排名

终局不能把游戏内失败和技术失败混成同一件事：

1. `completed` 且存活的有效 episode 进入正式排名，按最终净资产降序；
2. `dead` 或规则定义的 `bankrupt` 属于游戏内失败，排在所有存活完赛者之后，组内按退出时可清算净资产排序；
3. `model_timeout`、`tool_limit`、`loop_terminated`、`runtime_error` 属于技术 DNF，不授予正式名次，但保留卡片、轨迹和工具指标；
4. 若技术退出由平台故障而非模型行为造成，运行报告必须单独标记，不能计入模型失败率；
5. P0 不计算奖项或幸运标签；P0.5 可生成其他事实型标签，但技术 DNF 不参与“最幸运/最倒霉”。

Replay 可以同时展示净资产数值和正式名次，不能用一个看似正常的第五名掩盖技术退出。

### 4.4 模型预算与并发公平

每场 Match 固定：

- 每个 Agent 的最大决策调用数、最大工具动作数、单次输出上限和总墙钟上限；
- Probe 和正式决策默认零自动重试；若未来增加重试，必须对五个 Agent 使用相同、版本化且可审计的策略；
- 超出上下文下限的模型不得临时获得删减版 Observation；
- 传输失败且未产生模型结果时不扣工具预算，模型生成的无效 Action 计入可靠性指标；
- 并发只用于缩短后台运行时间，不能通过共享会话、共享缓存或调用顺序让 Agent 相互影响。

五个槽位必须配置为五个不重复的 `Provider + model` 组合。CLI 在 Probe 和正式运行前都必须拒绝重复组合；展示名称不参与该校验。

不同 Provider 的 Token 计数不可直接视为同一单位，因此 P0 以相同调用/动作上限保证流程公平，同时如实报告各自输入 Token、输出 Token、总 Token 和延迟。P0 不估算金额，也不把 Token 或延迟混入比赛名次。

---

## 5. 比赛模式

## 5.1 模型杯

P0 固定五个模型同场。五组配置分别来自不同的 `Provider + model` 组合，使用相同版本化中性 Prompt、相同无身份 Observation、相同工具、相同环境、相同 seed 和相同预算。

Provider、model、adapter version、slot 和运行审计信息只进入 Trace、Replay、Run Report 和 UI，不进入模型决策 Prompt。UI 以 `Provider + model` 作为唯一比赛身份，不使用 A/B/C/D/E、策略化展示名、颜色人格或 `personaId` 暗示策略。

模型杯展示：

- 长期资产表现；
- 债务管理；
- 风险偏好；
- 工具稳定性；
- 行情变化后的策略调整；
- P0.5 赛后采访公开计划与后续实际行为的一致性。

模型杯不预设人物性格。P0 不生成行为人格标签；P0.5 可由 Replay Enrichment 根据实际轨迹动态生成事实可追溯的展示标签。

示例标签：

- 铁算盘；
- 现金仓鼠；
- 胆大包天；
- 京城旅行家；
- 情报贩子；
- 光盘大王；
- 晚节不保；
- 绝地翻盘。

标签可以随 P0.5 回放日期切片动态变化，但只用于派生展示，不在 Runner 运行期间生成，也不写回 Agent 上下文。

模型杯的结果分为两层：

1. **单场结果**：用于观看，只能表述为“本场排名”；
2. **Benchmark 结果**：由多个 scenario、多个 seed 的配对比赛聚合得到，用于描述模型能力。

正式 Benchmark 至少统计：

- 最终净资产的均值、中位数和分布；
- 存活率与债务清零率；
- 最大回撤与负资产天数；
- 无效工具调用率、循环终止率和完成率；
- 输入/输出 Token 用量与延迟；
- 同 seed 配对胜率与排名稳定性。

P0 必须记录以上指标所需数据；多 seed 榜单、五维雷达图与公开排名页不在近期范围。人格杯不属于 P0，未来若恢复必须与模型杯分别统计。

## 5.2 人格杯

人格杯不属于 P0，以下内容保留为远期历史构想，不进入当前实施顺序或验收。

使用同一基础模型，配置不同的公开策略人格。

首版建议支持四种人格：

| 人格 | 策略约束 |
|---|---|
| 铁算盘 | 重视偿债、现金流和回撤控制 |
| 胆大包天 | 接受集中持仓和高波动机会 |
| 消息贩子 | 重视公开消息、街头传闻和试探交易 |
| 多种经营 | 倾向分散商品、地点和持仓 |

人格 Prompt 只定义稳定偏好，不规定某个日期必须采取某类动作。

不得写入以下指令：

- 前十天扩张；
- 中期梭哈；
- 最后十天清仓；
- 某天后必须降低风险；
- 某一章节必须追求特定目标。

## 5.3 周赛世界线

每周发布一个固定 scenario 与 seed，所有参赛 Agent 面对相同外部世界。

世界线以环境特征命名，不向 Agent 公开完整机制和未来事件安排。

示例：

| 世界线 | 公开简介 |
|---|---|
| VCD 黄金周 | 光盘交易活跃，市场消息频繁 |
| 水货手机风口 | 电子商品供需变化明显 |
| 假酒严查月 | 烟酒行情活跃，市场管理趋严 |
| 沙尘暴下的发财梦 | 健康管理成本上升 |
| 村长催债局 | 债务压力更强 |
| 京城太平月 | 市场波动相对平缓 |
| 年关将近 | 节庆消费相关商品需求变化 |
| 黑市寒冬 | 高风险商品经营难度提高 |

公开简介只描述背景，不公布事件发生日期、价格公式和精确概率。

---

## 6. Agent 可见信息与上下文契约

## 6.1 Agent 可见信息

每次决策允许提供：

```text
当前游戏日
剩余天数
当前位置
现金
存款
债务
健康
声望或其他已公开状态
当前库存
当前可观察价格
已经发生的个人事件
已经公开的世界消息
可调用工具及参数
```

## 6.2 Agent 不可见信息

不得提供：

```text
当前播放单元名称
动态幕标题
未来事件日程
事件概率配置
其他 Agent 的状态
其他 Agent 的排名
其他 Agent 的公开采访
其他 Agent 的工具动作
导演系统高光判定
潜在奖项条件
最终结局条件
前端解说和评论
```

## 6.3 决策 Prompt 稳定性

标准比赛期间不得根据当前排名或节目效果动态修改 Agent 的主 Prompt。

以下行为禁止：

- 因为比赛无聊而要求 Agent 冒险；
- 因为 Agent 落后而提示其梭哈；
- 因为 Agent 领先而提示其保守；
- 用“决赛阶段”“最后冲刺”等措辞推动行为；
- 将导演系统生成的剧情标题写入上下文。

## 6.4 历史上下文管理契约

所有参赛 Agent 必须使用同一种、可审计的上下文管理策略。P0 冻结为 `full-history-v1`：

```text
固定系统 Prompt
+ 当前一次无身份 Observation
+ 本局此前全部 action、result、effects 和 state diff
```

要求如下：

- 不发送旧 Observation 快照，不生成历史摘要，不截断历史，也不只保留最近 N 次；
- 不根据不同模型的上下文窗口做差异化裁剪、压缩或补充；
- 五个 Direct Agent 使用逐字节一致的 Observation Schema 和序列化策略；
- 不加载跨局经验、个人记忆或 `game_records`；
- Provider、model、slot、其他参赛者、排名、审计 ID 和 Enrichment 信息不得进入模型上下文；
- 每次实际发送给模型的完整上下文保存 hash，hash 必须覆盖系统指令、当前 Observation 和本局此前全部动作事实；
- Provider 明确返回上下文超限时记录为 `runtime_error + context_limit` 技术 DNF，零重试、零压缩，其余 Agent 继续；
- Run Report 记录 model revision、sampling parameters、总墙钟、请求与 action 的逐条关联、故障责任归属以及输入/输出 Token；
- 每场 Match 必须创建全新 session，任何前轮 Runner 或 Replay Enrichment 的结果、采访和叙事均不得进入下一轮上下文；
- 原始请求/响应正文仅在显式诊断开关开启时保存，并遵守 §19.3 的独立目录与脱敏规则。

---

## 7. 时间线、播放单元与动态幕结构

## 7.1 全局日期游标与五日刻度

P0 前端以 `visibleThroughDay` 作为唯一的全局日期游标，范围为 1～40。所有可视区域必须同步响应游标，不得各自保存可能失配的日期状态。

时间轴每五个游戏日设置一个中性刻度：

```text
第 1～5 天
第 6～10 天
第 11～15 天
第 16～20 天
第 21～25 天
第 26～30 天
第 31～35 天
第 36～40 天
```

五日刻度仅用于：

- 前端时间导航；
- 快速跳日；
- 标识数据密度。

默认 UI 使用中性日期名称：

```text
第一个五日
第二个五日
第三个五日
……
```

不得预设：

```text
第一桶金阶段
债务危机阶段
中盘豪赌阶段
严打阶段
最后冲刺阶段
```

P0 不实现自动播放和自动节奏控制。观看者可以逐日前进或直接拖动到任意日期。P0.5 加载 Enrichment 后可增加高光跳转和动态幕章节书签。跳到更晚日期等同于主动揭示截至该日的全部内容。

## 7.2 动态幕生成

动态幕属于 P0.5。完整比赛结束后，导演系统根据真实轨迹生成 3～6 个动态幕。动态幕在数据层预先生成，但前端只有在游标达到该幕 `revealDay` 后才能显示标题和摘要。

动态幕切分触发条件包括：

- 首个重大盈利；
- 首个重大亏损；
- 第一名发生变化；
- Agent 从末位进入前二；
- Agent 从第一跌至末位；
- 首次还清债务；
- 首次进入负资产；
- 首次健康降至危险区间；
- 发生重大检查或没收；
- 进入最后十个游戏日；
- 出现决定最终排名的交易；
- 终局结算。

动态幕标题必须描述已经发生的事实，不得给 Agent 提前展示。

示例：

```text
第一幕：五个人的第一笔生意
第二幕：某模型的光盘库存突然升值
第三幕：一次检查改变了全部排名
第四幕：水货手机让末位选手回到牌桌
第五幕：村长进京前的最后三天
```

## 7.3 动态幕数据结构

```ts
interface ReplayAct {
  id: string;
  startDay: number;
  endDay: number;
  revealDay: number;
  title: string;
  summary: string;
  triggerType: string;
  evidenceEventIds: string[];
  generatedAfterMatch: true;
}
```

所有 `ReplayAct` 必须在 episode 全部结束后生成。

未来动态幕的标题、摘要和标记在达到 `revealDay` 前不得进入时间轴、渲染树、搜索索引、无障碍文本或任何交互候选。它们只存在于独立 Enrichment payload，不进入事实 Replay；防剧透不对主动检查文件源码的人提供对抗性保密。

---

## 8. P0.5 赛后采访机制

采访不是 Runner 的一部分。必须先完成五个 episode、统一结算、Replay 校验和事实 hash 固化，再由独立 Replay Enrichment 发起采访。采访失败、超时或字段无效不得修改比赛事实、不得重跑 episode，也不得阻塞事实版 `replay.html`。

## 8.1 调用时机

P0.5 可在完成整场比赛后，按以下历史截面生成公开采访：

```text
第 5 天结束
第 10 天结束
第 15 天结束
第 20 天结束
第 25 天结束
第 30 天结束
第 35 天结束
终局结束
```

这些日期表示采访输入允许看到的事实截止日，不表示比赛运行中实时调用。采访不消耗游戏天数，不计入 Runner 工具预算；调用数、输入/输出 Token、延迟和错误单独写入 Enrichment Report。

## 8.2 无状态隔离调用

采访是通用第六模型配置的唯一例外：每位选手的采访调用该选手比赛时使用的原 `Provider + model`，但创建全新无状态 session，不复用游戏 Agent 的持续决策上下文、缓存或 conversation ID。

输入仅包括：

- 截至采访日的该选手公开状态；
- 该选手截至采访日的动作摘要；
- 该选手截至采访日已经经历的事件和结果；
- 中性采访问题。

采访输出：

- 写入独立 Enrichment 产物；
- 不写回游戏状态；
- 不写回事实 Replay、Trace、Run Report 或 Agent 记忆文件；
- 不加入本场或下一场 Runner 的决策上下文；
- 不提供其他 Agent 信息。

采访产物必须引用来源 Replay hash 和事实证据 ID。即使生成时整场 Replay 已存在，某个历史采访也只能读取该采访日及以前的该选手事实，不得利用未来结果伪造当时判断。

## 8.3 中性采访问题

固定问题如下：

```text
1. 请概括你当前的资产、债务和主要持仓。
2. 你目前优先关注的因素是什么？
3. 你认为当前最大的不确定性是什么？
4. 请用 0～100 表示你对当前局面的信心。
5. 请预测 5 天后你的净资产区间。
6. 你当前最看好和最不看好的商品各是什么？
7. 请用 30 个中文字符以内说一句自由发言。
```

终局问题：

```text
1. 你认为本局最关键的一次决定是什么？
2. 你认为本局最大的一次失误是什么？
3. 用一句话总结这 40 天。
```

## 8.4 输出格式

```ts
interface PublicInterview {
  agentId: string;
  day: number;
  assetSummary: string;
  currentPriority: string;
  largestUncertainty: string;
  confidence: number;
  prediction?: {
    targetDay: number;
    netWorthMin: number;
    netWorthMax: number;
    favoredCommodityId: string;
    unfavoredCommodityId: string;
  };
  freeStatement?: string;
  finalReflection?: string;
  promptVersion: string;
  promptHash: string;
  sourceSnapshotId: string;
  sourceReplayHash: string;
  enrichmentVersion: string;
}
```

所有文本字段限制长度，避免生成长篇分析：

- 单字段最多 50 个中文字符；
- 终局总结最多 80 个中文字符；
- `confidence` 必须为 0～100 的整数。
- `targetDay` 为 `min(采访日 + 5, 40)`；
- `netWorthMin` 不得大于 `netWorthMax`；
- 看好与不看好商品必须来自当前规则中的商品 ID；
- 第 40 天终局采访不再生成未来预测；
- 采访 Prompt 固定并版本化，比赛过程中不可编辑；
- 预测与实际结果的对账只进入 Enrichment 展示层，不写回事实 Replay 或任何 Runner 上下文。

---

## 9. 世界事件与随机系统

## 9.1 事件分类

事件分为三类：

### 公共世界事件

对所有 Agent 在同一游戏日生效，例如：

- 某类商品供货紧张；
- 某市场开展检查；
- 节庆需求变化；
- 交通成本变化；
- 公共卫生或天气影响。

公共世界事件由 `scenario + seed + day + eventType` 决定，所有 Agent 一致。

### 行为触发事件

由 Agent 自身状态和行为决定，例如：

- 高风险商品持仓过高后遭遇检查；
- 健康过低后触发治疗事件；
- 债务比例过高后触发催债；
- 现金携带过多后触发损失；
- 声望达到条件后获得特殊机会。

行为触发事件可以因 Agent 策略不同而不同。

### 个人随机事件

不影响其他 Agent，但必须使用独立随机流。个人随机事件由：

```text
seed + agentSlot + day + subsystem + eventIndex
```

决定，不能因额外查询状态或无效工具调用而改变后续随机序列。

## 9.2 事件时间窗口

事件使用时间窗口、条件和概率配置，不使用固定剧情章节排期。

示例：

```yaml
id: market_enforcement_vcd
scope: global
window:
  start_day: 8
  end_day: 32
probability_per_day: 0.12
max_occurrences: 2
cooldown_days: 5
conditions:
  market_activity_above: 0.4
public_message_lead_days:
  min: 0
  max: 2
```

行为事件示例：

```yaml
id: debt_collection_pressure
scope: personal
window:
  start_day: 10
  end_day: 40
probability_per_day: 0.25
max_occurrences: 3
conditions:
  debt_asset_ratio_above: 0.65
cooldown_days: 4
```

## 9.3 事件配置要求

每个 scenario 必须允许出现不同节奏：

- 前期发生重大风险；
- 中期发生重大机会；
- 后期保持平静；
- 全程高波动；
- 全程低波动；
- 某类事件完全不发生。

不得让所有 scenario 都遵循相同时间模板。

## 9.4 随机源隔离

至少拆分以下随机子系统：

```text
market_price
public_event
personal_event
health_event
enforcement_event
information_quality
npc_offer
```

工具调用次数和状态查询次数不得消耗游戏随机数。P0.5 采访发生在事实 Replay 固化之后，不得访问或推进游戏随机流。

---

## 10. 商品系统

首版沿用现有游戏商品和交易规则，在数据层新增展示与导演元数据。

建议商品元数据：

```ts
interface CommodityMeta {
  id: string;
  displayName: string;
  category: "ordinary" | "gray" | "illegal" | "jackpot";
  volatilityLevel: number;
  enforcementRiskLevel: number;
  liquidityLevel: number;
  narrativeTags: string[];
  highlightThresholds: {
    concentratedPositionRatio: number;
    majorProfitRatio: number;
    majorLossRatio: number;
  };
}
```

商品展示分类可包括：

| 类型 | 展示定位 |
|---|---|
| 小本生意 | 入门、周转快、单价低 |
| 日常倒货 | 相对稳定、适合持续交易 |
| 高风险商品 | 收益和处罚风险均较高 |
| 终极豪赌 | 单笔金额大、结果波动大 |

商品标签只服务于事实前端或 P0.5 Enrichment，不直接改变 Agent Prompt。

---

## 11. 地点系统

首版沿用现有地点，新增三类元数据：

```ts
interface LocationMeta {
  id: string;
  displayName: string;
  visualTags: string[];
  marketTags: string[];
  narrativeTags: string[];
  ambientText: string[];
}
```

地点展示应体现：

- 视觉身份；
- 常见商品；
- 市场氛围；
- 风险类型；
- 可出现的人物和消息。

第一阶段不要求重做地图算法。地点差异可以先用于：

- 前端背景；
- 事件文案；
- 解说措辞；
- NPC 出现条件；
- 信息来源标签。

第二阶段再逐步影响价格分布、风险和交易机会。

---

## 12. 信息系统

信息分为三种：

### 12.1 公共消息

所有 Agent 同时获得，内容相对可靠但不提供精确结论。

示例：

```text
进口电子商品近期供货趋紧。
有关部门将加强部分市场的经营检查。
节日前夕，服装和玩具交易开始活跃。
```

### 12.2 地点传闻

仅由当前所在地触发，可靠度不固定。

```text
中关村有人说水货手机很快会涨。
市场里传出近期要检查假酒，但没人能确认具体时间。
```

### 12.3 付费或条件消息

由 NPC、声望或事件触发，信息更具体，但需要付出现金、时间或其他资源。

信息对象必须保存：

```ts
interface InformationItem {
  id: string;
  day: number;
  scope: "global" | "location" | "personal";
  reliability: number;
  content: string;
  relatedEventId?: string;
  visibleToAgentIds: string[];
}
```

信息只描述可能性，不直接要求 Agent 采取行动。

---

## 13. NPC 与结构化事件

NPC 以结构化事件和有限选项出现，不做无限自由对话。

建议 NPC：

- 村长；
- 催债人；
- 市场熟人；
- 柜台老板；
- 票贩子；
- 市场管理员；
- 执法人员；
- 医院大夫；
- 银行职员。

事件格式：

```ts
interface NpcEvent {
  id: string;
  npcId: string;
  day: number;
  title: string;
  description: string;
  options: Array<{
    id: string;
    label: string;
    cost?: Record<string, number>;
    resultType: string;
  }>;
  triggerConditions: Record<string, unknown>;
}
```

选项文案必须描述行为，不评价哪个选项正确。

---

## 14. P0.5 Replay Enrichment 导演系统

导演系统不属于 P0 Runner。它只读取已完成且验证通过的事实 Replay，不得修改游戏状态、补发事件、重新要求 Agent 决策或覆盖事实文件。

除 §8 采访外，所有需要模型的 Enrichment 通用生成任务必须使用独立第六模型配置。该配置的 `Provider + model` 不能与五个 Runner 配置中的任何一个重复，也不能复用其密钥变量、session、上下文或缓存。程序化高光等不需要模型的任务仍在同一独立 Enrichment 管线中执行。

导演系统负责：

1. 将工具调用转换为可读事实；
2. 识别高光；
3. 计算重要性；
4. 合并重复动作；
5. 生成逐日导航索引；
6. 生成动态幕；
7. 生成解说输入；
8. 选择赛后关键转折点；
9. 对采访预测与后续事实生成可验证的对账关系。

Enrichment 只负责“把值得看的事实找出来并组织好”，不自动替观看者推进页面。P0 事实查看器不依赖导演系统；自动播放与节奏编排不在当前范围。

## 14.1 高光类型

高光统一属于 P0.5。先交付 8 类程序化、证据驱动的核心高光，再按需扩展到 16 类。所有百分比、时间窗口和金额阈值都进入版本化 Enrichment 规则配置，禁止写死在解说 Prompt 中。

| 高光 | 程序判定 | 阶段 |
|---|---|---|
| 一夜暴富 | 单日净资产增长超过设定阈值 | P0.5 |
| 当场跳水 | 单日净资产下降超过设定阈值 | P0.5 |
| 逆袭 | 从末位进入前二 | P0.5 |
| 跌落神坛 | 从第一跌至末位 | P0.5 |
| 债务危机 | 债务超过可清算资产 | P0.5 |
| 成功上岸 | 债务首次归零 | P0.5 |
| 濒死或出局 | 健康低于危险阈值，或发生死亡、破产、技术退出 | P0.5 |
| 公开打脸 | 净资产实际值落在公开预测区间之外，或看好/不看好判断与后续价格表现明显相反 | P0.5 |
| 梭哈 | 单次买入使用超过可用现金的 80% | P0.5 |
| 重仓 | 单一商品占总资产超过 70% | P0.5 |
| 买在山顶 | 买入后短期价格显著下跌 | P0.5 |
| 卖飞 | 卖出后短期价格显著上涨 | P0.5 |
| 全军覆没 | 大量库存被没收或损毁 | P0.5 |
| 京城乱逛 | 连续移动但没有有效交易 | P0.5 |
| 工具事故 | 连续无效或重复工具调用 | P0.5 |
| 嘴硬时刻 | 高信心后短期出现重大损失 | P0.5 |

## 14.2 重要性评分

P0.5 首版使用可解释的两项粗排：

```text
importance =
资产影响 × 0.55
+ 排名影响 × 0.45
```

各项标准化为 0～1。

以下事件不受粗排结果限制，至少提升为 `highlight`：

- 死亡或破产；
- 债务首次清零；
- 第一名发生变化；
- 从末位进入前二或从第一跌至末位；
- 重大没收、住院或库存损毁；
- 终局结算；
- 采访预测被后续事实明确验证或否定。

事件稀有度、采访反差和终局权重等扩展评分在 P0.5 后续迭代中按需增加，并必须先给出可重复计算的定义。

重要性评分只决定展示优先级，不影响比赛分数。

## 14.3 人工推进与未来自动节奏

导演系统仍将事件分为：

- `routine`：普通行为，可合并为当日摘要；
- `notable`：在事件流中突出显示；
- `highlight`：提供横向对比卡和日期跳转；
- `turning_point`：生成动态幕或赛后关键节点。

P0.5 只使用这些等级决定 Enrichment 视觉层级和导航，不自动暂停、快进或切换页面。自动播放若未来恢复，再根据等级安排速度和停顿。

连续同类交易可合并展示：

```text
原始日志：连续 6 次买入盗版 VCD
回放字幕：某模型在当天分 6 次买入，共购入 120 张盗版 VCD
```

---

## 15. P0.5 解说系统

解说是独立 Replay Enrichment，不是 P0 Runner 或事实 Replay 的组成部分。涉及 LLM 的通用解说调用使用 §14 定义的第六模型配置；关闭或删除解说后，P0 Replay、Trace、Run Report、事实 hash 和正式排名保持不变。

## 15.1 事实层

先由程序生成结构化事实：

```ts
interface CommentaryFact {
  eventId: string;
  day: number;
  agentId: string;
  action: string;
  item?: string;
  quantity?: number;
  amount?: number;
  cashBefore?: number;
  cashAfter?: number;
  netWorthBefore?: number;
  netWorthAfter?: number;
  rankBefore?: number;
  rankAfter?: number;
  riskRatio?: number;
}
```

## 15.2 文案层

LLM 只能基于 `CommentaryFact` 和指定风格生成短解说，不得补充未提供的事实。

娱乐化解说可以：

- 使用比喻、反问、夸张语气和市井化措辞；
- 使用“像是”“仿佛”“看起来”等带保留的主观解读；
- 调侃公开计划与实际行为之间的反差；
- 根据已经发生的结果制造包袱。

娱乐化解说不得把推测包装成确定事实，不得声称知道 Agent 的真实心理，也不得在日志没有因果关系时断言某行为必然导致某结果。

解说长度：

- 普通字幕：20～40 字；
- 重点解说：40～80 字；
- 动态幕摘要：80～150 字；
- 赛后人物总结：100～200 字。

P0.5 使用一个随版本发布、经过验证的默认解说 Prompt。所有 LLM 解说在展示前生成并写入独立 Enrichment 产物，现场事实查看不依赖模型或互联网。

以下能力均属于 P0.5：

- 编辑解说 Prompt；
- 用 10 条代表性事实抽样预览；
- 全量重新生成解说；
- 保存、切换并比较不同解说版本；
- 新版本不覆盖旧版本，且不修改事实 Replay。

## 15.3 事实校验

生成后执行校验：

- 所有数值必须来自输入；
- 不允许新增商品、地点或事件；
- 不允许把推测的内心动机写成确定事实；
- 只有日志保存了明确因果关系时，才允许作确定因果表述；
- 其他主观解读必须使用带保留的修辞；
- 不允许预测后续尚未发生的结果；
- 不允许使用导演标题影响 Agent。

校验失败时退回程序模板或省略该条内容，不阻塞事实 Replay 生成。

---

## 16. P0.5 奖项与运气标签系统

所有奖项通过结构化日志计算，并写入独立 Enrichment 产物。P0.5 先做 10 个覆盖胜负、偿债、风险与笑点的奖项，再按需扩展到完整奖池。

| 奖项 | 判定规则 | 阶段 |
|---|---|---|
| 京城首富 | 最终净资产最高 | P0.5 |
| 债务清零先进个人 | 最早还清全部债务 | P0.5 |
| 逆天改命 | 从最低排名升至最终第一 | P0.5 |
| 铁算盘 | 存活、偿债且最大回撤最低 | P0.5 |
| 梭哈大王 | 单次投入占可用资产比例最高 | P0.5 |
| 买在山顶 | 买入后遭遇最大短期跌幅 | P0.5 |
| 卖飞专家 | 卖出后错过最大短期涨幅 | P0.5 |
| 医院年度会员 | 治疗相关支出或次数最多 | P0.5 |
| 村长重点关照对象 | 终局未偿债务最高 | P0.5 |
| 最强嘴硬 | 公开信心与后续表现偏差最大 | P0.5 |
| 第一桶金 | 最早达到指定净资产门槛 | P0.5 |
| 倒货之王 | 商品交易累计利润最高 | P0.5 |
| 现金为王 | 全局平均现金比例最高 | P0.5 |
| 多种经营模范 | 持仓分散度最高 | P0.5 |
| 京城旅行家 | 有效移动次数最多 | P0.5 |
| 高风险常客 | 高风险商品交易次数最多 | P0.5 |
| 破产艺术家 | 曾经领先但最终破产或负资产 | P0.5 |
| 毫发无伤 | 健康结局最佳且重大处罚最少 | P0.5 |
| 工具灾难奖 | 无效工具调用率最高 | P0.5 |
| 错失良机 | 有能力交易但错过最大已知机会，不计算未执行动作的反事实轨迹 | P0.5 |

奖项结果结构：

```ts
interface MatchAward {
  id: string;
  title: string;
  agentId: string;
  value?: number;
  description: string;
  evidenceEventIds: string[];
  category: "achievement" | "entertainment";
}
```

原则上每个 Agent 至少获得一个适用奖项。若没有任何规则奖项命中，则生成基于最高特征值的行为标签，不伪造荣誉。

“最幸运/最倒霉”只在 P0.5 根据事实 Replay 计算。技术 DNF 无论退出日期和原始事件计数如何，均不参与该评选；P0 只保留个人随机事件的原始事实与计数，不生成价值判断标签。

---

## 17. P0.5 结局系统

结局是独立 Replay Enrichment。结局生成不得修改核心终局状态、正式排名或事实 hash。

## 17.1 基础结局

| 条件 | 结局名称 |
|---|---|
| 死亡或健康归零 | 京城梦断 |
| 无法偿债且净资产不足 | 村长进京 |
| 还清债务但资产较低 | 平安上岸 |
| 有一定积蓄并存活 | 在北京站住了脚 |
| 最终净资产较高 | 倒货新贵 |
| 最终净资产达到高门槛 | 富人榜传奇 |

## 17.2 个性化结局输入

从日志中提取：

```text
最终净资产
最终债务
最终健康
最赚钱商品
最大单次盈利
最大单次损失
最大错误或卖飞事件
关键转折点
最终排名
主要行为标签
```

## 17.3 结局输出

每个 Agent 生成：

- 结局名称；
- 100～200 字人物结局；
- 3 个事实标签；
- 对应证据事件 ID。

后续可为每个结局增加 30～60 字分享卡摘要；分享卡不属于 P0。

结局文本只能总结已发生事实，不为 Agent 补写未发生的人生后续。

---

## 18. 前端信息架构

## 18.1 单一观众看板

P0 只有一套横屏观众看板。个人浏览、镜像投屏和真人手动讲解都使用同一界面、同一权限和同一可见数据。

前端不设计主持人、备课、私密收藏、备注、第二屏、遥控器或角色切换。真人手动跳转只是普通观看操作，不形成独立产品模式。

进入比赛时展示：

- 比赛名称；
- 世界线名称与公开背景；
- 五个参赛模型的 `Provider + model`；
- 相同初始条件；
- 40 天规则；
- “从第 1 天开始”入口。

不得展示未来事件和预设章节。

## 18.2 主回放页

建议单一横屏布局：

```text
┌────────────────────────────────────────────────┐
│ 第 18 / 40 天 · 全局日期游标 · 五日刻度              │
├───────────────┬────────────────────────────────┤
│ 当日净资产排名  │ 五模型状态卡                      │
│ 当日公共消息    │ 现金 / 债务 / 健康 / 持仓 / 当前动作 │
├───────────────┴────────────────────────────────┤
│ 净资产曲线（只画到第 18 天）· 公共事件标记            │
├────────────────────────────────────────────────┤
│ 当日事件流 · 完整事实动作与结果                     │
├────────────────────────────────────────────────┤
│ 总览 | 模型详情 | 事实对比 | 终局（未解锁）          │
└────────────────────────────────────────────────┘
```

北京地图作为可展开的地点信息层，不长期占据核心对比区域。主画面优先保证五个模型的同日事实差异一眼可见。P0.5 Enrichment 可以增加高光、采访和解说视图，但必须作为可关闭的派生层加载。

## 18.3 日期游标与防剧透

全局日期游标控制：

- 五个 Agent 的所有状态和动作；
- 排名、资产、债务与健康曲线；
- 公共消息和个人事件；
- Agent 详情与事件对比弹窗；
- 终局标签页和后续导出内容。

若加载 P0.5 Enrichment，同一游标还必须控制采访、预测对账、动态幕、高光、奖项和结局。

约束如下：

- 页面初次打开默认从第 1 天开始；
- 图表序列只绘制到 `visibleThroughDay`；
- 未来事件标记、标题、Tooltip、ARIA 文本和搜索结果均不可见；
- 终局标签页在第 40 天前锁定；
- 主动拖到更晚日期即表示观看者选择揭示截至该日的内容；
- 观看者可直接输入或拖到指定日期；P0.5 高光跳转只展示已经揭示的条目。

P0 防剧透目标是避免正常界面意外泄露，不对主动检查本地 Replay 文件或浏览器开发工具的用户提供对抗性保密。

## 18.4 公共事件事实与 P0.5 关键事件对比

P0 事实页只需要展示公共事件本身，并在五个 Agent 的既有状态、动作和结果区域中呈现可核对影响；不自动挑选“关键事件”，也不额外生成五栏影响矩阵或主观因果解释。

P0.5 Replay Enrichment 可以从事实 Replay 中挑选重大事件，生成导演筛选的横向对比卡：

```text
公共事件：中关村市场检查

Provider 甲 + Model 甲：已提前离开，无直接损失
Provider 乙 + Model 乙：持有相关商品，库存被没收
Provider 丙 + Model 丙：当天在其他地点，未受影响
Provider 丁 + Model 丁：未持有相关商品
Provider 戊 + Model 戊：已技术 DNF，当日无新动作
```

所有对比内容来自结构化状态，不使用主观推断，并引用来源 Replay hash 与证据事件 ID。

P0.5 采访预测到达目标日后，可在 Enrichment 视图展示对账卡：

```text
第 10 天预测：第 15 天净资产 12,000～16,000 元
第 15 天实际：8,400 元
结果：低于预测下限 3,600 元
证据：采访快照 + 第 15 天估值事件
```

预测对账在目标日之前不得展示结果。

## 18.5 Agent 详情页

展示：

- 当前状态；
- 持仓结构；
- 资产曲线；
- 债务曲线；
- 健康曲线；
- 最近动作；
- Provider、model、adapter version；
- 请求、有效/无效动作与故障摘要；
- 第 40 天后显示核心正式结算。

公开采访、高光、预测对账、奖项和结局只在加载 P0.5 Enrichment 后出现。

中途死亡、破产或技术退赛后，Agent 卡片保持原位并转为灰化状态，显示明确的出局类型与日期。后续日期不再伪造动作，也不从五模型对比中移除；技术 DNF 不显示正式名次。

## 18.6 终局揭晓

当日期游标达到第 40 天后，P0 终局标签页解锁并展示：

1. 最终领奖台；
2. 最终资产、债务、健康和排名；
3. 净资产曲线；
4. 排名变化；
5. 技术 DNF 分类、退出日期和故障归属；
6. 完整 Replay 回看入口；
7. Replay hash。

P0.5 可在事实终局之后增加动态幕、关键转折、奖项、个性化结局和本地出图。所有非终局派生内容继续受日期游标约束，不得把未来数据带入图片。

## 18.7 离线与镜像投屏

- 展示端加载本地静态资源和 Replay 文件即可运行；
- 现场断网不影响逐日查看、图表、事实事件卡和终局；
- 页面不得在运行时请求模型或远程素材；
- 镜像投屏与电脑屏幕显示同一页面，不存在隐藏控制区；
- 字体、图片和音效均随离线包交付；
- P0.5 Enrichment 若使用模型，必须在展示前完成；现场仍不得实时调用模型；
- 自动播放、自动停顿和无人值守模式不在 P0。

## 18.8 UX 与视觉方向

视觉方向采用“2000 年前后北京财经小报 × 行情电子屏”，重点是数字可读、角色可辨和事件有戏，不把界面做成高密度后台。

- 基础画布以 16:9 横屏设计，优先验收 1920×1080 和 1366×768；
- 背景使用低对比米灰或深炭色，关键涨跌与警报使用受控的红、绿、黄，不依赖颜色单独传达含义；
- 五个模型在整场比赛中使用固定颜色和图形纹理，排名变化不改变身份色；文字身份始终只显示 `Provider + model`；
- 投影状态下正文不低于 18 px，关键数字不低于 28 px；
- 地图、持仓明细和长文本默认收起，主画面始终保留日期、排名、五模型状态与资产曲线；
- 普通日切换使用 150～250 ms 的轻量过渡，排名反转和终局揭晓可使用一次性强调动画；
- 支持键盘左右键逐日切换、数字输入跳日、`Esc` 关闭弹窗；
- 当一次跳转跨越未揭示日期时，按钮文案明确写“揭示至第 N 天”，避免误触；
- 支持 `prefers-reduced-motion`，所有图表和事件卡均提供文本等价信息；
- P0 不做手机专用布局；窄屏只保证可浏览，不以手机遥控或现场控制为目标。

页面状态只保留一个 `visibleThroughDay`。各组件不得自行复制 Replay 并做局部截断，而应统一从经过过滤的 `VisibleReplaySlice` 读取，降低防剧透漏口。

## 18.9 素材清单与 Image Gen 边界

P0 不以成套插画为上线前提，先用 CSS、内嵌 SVG、系统字体和数据可视化完成可读闭环。所有素材必须本地化、记录来源与许可证，禁止运行时引用 CDN。

| 素材 | 数量 | 建议格式与规格 | 阶段 | 生成方式 |
|---|---:|---|---|---|
| 产品字标与简化印章 | 1 套 | SVG，深浅色各一版 | P0 | 人工排版，不用 Image Gen |
| Agent 身份色与纹理 | 5 套 | CSS Token + SVG Pattern | P0 | 程序化，不用 Image Gen；不使用字母代号或人格形象 |
| 状态与事件图标 | 24～32 个 | 单色 SVG，24/32 px | P0 | 统一开源图标集并本地打包，必要时人工补绘 |
| 商品图标 | 8 个 | SVG 或透明 PNG，512×512 | P0.5 | 可用 Image Gen 生成草图，人工统一轮廓与颜色 |
| 世界线封面 | 首批 6 张 | WebP，1600×900，无文字 | P1 | Image Gen |
| 代表地点背景 | 首批 6 张，不为 20 个地点逐一作图 | WebP，1600×900，暗角留出文字区 | P1 | Image Gen |
| NPC 半身像 | 首批 6 个 | 透明 WebP/PNG，1024×1280 | P1 | Image Gen |
| 人格杯角色像 | 暂不规划 | 透明 WebP/PNG | 远期 | 人格杯不在当前范围；模型杯不用厂商拟人像 |
| 六类结局氛围图 | 6 张 | WebP，1200×1500，无文字 | P1 | Image Gen |
| 背景纸张、票据与噪点纹理 | 3～5 张 | 可平铺 WebP，1024×1024 | P0.5 | 优先程序化；必要时 Image Gen |
| 高光、排名反转、终局音效 | 3～5 个 | OGG + MP3，每个 0.3～1.5 秒 | P1 | 采购或原创，不使用 Image Gen |
| 分享卡版式 | 3 套 | HTML/CSS 模板，1200×1500 或 1600×900 | P0.5 | 前端排版，不用 Image Gen |

Image Gen 素材统一要求：同一批次固定艺术方向和色板；避免可识别商标、真实人物肖像和可读文字；保留原始提示词、seed、生成日期与人工修改记录；最终文字全部由前端叠加，不能烤进图片。现有仓库根目录的 `image.png` 仅可作为原项目参考图，未完成来源、分辨率和授权核验前，不直接进入 Arena UI。

---

## 19. 技术架构

## 19.1 历史仓库基线与 v2.2 目标

下表保留 v2.1 立项时对原 MCP 仓库的历史诊断，用于解释架构来源，不代表 v2.2 当前实现状态。实际完成进度与验收事实以 [`docs/project-status.md`](project-status.md) 为准。

| v2.1 立项时的历史事实 | 对 Arena 的影响 | v2.2 目标 |
|---|---|---|
| Node.js + TypeScript ESM，游戏规则主要位于 `GameEngine` | 语言栈可复用 | 保持 TypeScript，先抽出纯 `GameEnvironment` |
| `src/index.ts` 创建单个全局 `GameEngine` | 该历史 MCP 结构无法承载五 Agent Direct Match Runner | 环境实例由 episode 工厂创建，不使用全局单例 |
| 所有随机数来自 `Math.random()` | 无法用 seed 重放，查询和事件可能共享隐式随机序列 | 引入版本化 seeded RNG 与命名随机流 |
| MCP 工具直接调用引擎方法 | Direct Model 模式无法复用同一入口契约 | 建立 `Observation`、`GameAction`、校验器和 `step()` 核心接口 |
| 返回值包含状态快照和文本事件，但没有事件 ID、before/after/diff | 无法可靠生成 Replay、证据链和高光 | 增加不可变快照、结构化事件与 hash |
| 终局库存按 Agent 最后所在地的当前市场价卖出 | 同场终局估值不统一 | 改为 §4.1 的 scenario 统一终局收购价 |
| MCP 同时暴露跨局记录和自更新工具 | 若未来进入 strict MCP 会污染 Benchmark，且引入文件与网络副作用 | P1 再设计 strict MCP；P0 保持 Direct-only |
| 没有测试框架、Match Runner、Replay 或 Web | 无法验证公平性，也没有展示闭环 | 按 §24 分阶段补齐，不在一次重构中混做 |

历史内容基线包括 8 种商品、20 个地点、18 个市场事件、12 个健康事件和 7 个现金损失事件。v2.2 继续以这批内容的结构化、确定化和事实闭环为优先，不以新增大量世界线为前置条件。

## 19.2 P0 Direct-only 分层与 P1 MCP 边界

游戏规则不得继续绑定在 MCP Server 入口中。P0 正式架构分为：

```text
五组 Direct Model Driver ─ Match Runner ─ GameEnvironment
                                      ├─ Episode Trace
                                      ├─ Fact Replay
                                      └─ Run Report

Fact Replay ─ 独立 P0.5 Replay Enrichment ─ Enrichment Artifact / Enriched HTML
```

Scripted Driver 可以在内部测试中复用 `GameEnvironment`，但不出现在产品命令、产品范围、P0 金样或交付声明中。strict MCP 仅作为 P1 方向保留，P0 不迁移、不扩建、不验收。

核心接口：

```ts
interface GameEnvironment {
  reset(config: EpisodeConfig): Observation;
  observe(): Observation;
  step(action: GameAction): StepResult;
  finalize(): FinalResult;
}

interface AgentDriver {
  decide(input: AgentDecisionInput): Promise<AgentDecision>;
}
```

Direct 模式中的模型工具调用循环由 `AgentDriver` 管理，五个 episode 都落到独立的 `GameEnvironment.step()`。P0 不包含外部 Host 工具循环。

接入要求：

- **Direct Model 模式**：Match Runner 通过模型供应商适配器主动请求决策并执行工具动作，是 P0 唯一产品入口；
- 五个 Runner 配置的 `Provider + model` 组合必须互不重复；通用 Enrichment 的第六配置还必须与这五组都不同；
- **Scripted 内部回归**：只用于确定性核心、Replay 重建和故障 fixture，不作为产品模式、交付物或 P0 验收场；
- **strict MCP**：移入 P1。届时仍应复用 Observation、GameAction、校验器和事件日志，但不得据此宣称当前已经实现；
- 原版 legacy MCP 入口可以保持现状，但不扩建，不计入 Arena P0 完成声明；
- MCP Host 自动编排明确不属于 P0。

P1 若启动 strict MCP，SDK 迁移必须独立立项，不与 P0 Direct Runner 收口或游戏规则修改混成一次不可回退的改动。

## 19.3 技术选型与展示端架构

| 层 | P0 选择 | 选择理由 |
|---|---|---|
| 运行时与语言 | Node.js + TypeScript strict + ESM | 延续当前仓库；精确版本以项目锁定和 CI 验证为准 |
| Schema | Zod | 当前已使用；统一校验 MatchConfig、Action、Observation、Event 与 Replay |
| 核心状态 | 纯 TypeScript 状态机 + 版本化 seeded RNG | 不把规则绑定到 MCP、模型 SDK 或 UI |
| Direct Model | 自有 `ModelProviderAdapter` 小接口，供应商原生 SDK 分适配器 | 保留工具调用、用量、错误和采样参数的可审计性，不引入黑盒 Agent 框架 |
| MCP | P0 不开发；legacy 入口保持现状 | strict MCP 移入 P1，不阻塞 Direct-only P0 |
| Web | React + TypeScript + Vite | 适合拆分看板组件并输出纯静态资产；React 与 Vite 均有官方 TypeScript 支持 |
| 图表 | 原生 SVG 或 Apache ECharts | ECharts 是建议而非硬要求；原生 SVG 满足功能、可访问性与性能即可 |
| UI 状态 | `useState` 或 `useReducer` + Context | Reducer/Context 是复杂状态出现后的建议，不为形式重构 |
| 样式 | CSS Variables；CSS Modules 可选 | CSS Modules 是建议而非硬要求 |
| 单元与契约测试 | 现有 Node test、Vitest 或等价框架 | Vitest 是建议；以覆盖充分、可重复为验收依据 |
| 浏览器验收 | 可重复自动浏览器验收 | 是 P0 硬要求；Playwright、浏览器控制或等价工具均可 |

选型参考：[React TypeScript](https://react.dev/learn/typescript)、[Vite](https://vite.dev/guide/)、[ECharts](https://echarts.apache.org/handbook/en/)、[Vitest](https://vitest.dev/guide/)、[Playwright](https://playwright.dev/docs/intro)。其中 ECharts、Vitest、CSS Modules 和 Reducer/Context 都不是 P0 强制品牌或实现形式。依赖的精确版本锁定到 lockfile。

P0 Web 是只读、离线优先的单页应用：

- 标准产物包含可审计的 `replay.json` 和可双击打开的独立 `replay.html`；
- 构建器要求显式输入 Replay；缺失或校验失败时直接报错，不使用 sample、模拟排名或模拟动作 fallback；
- `replay.html` 内嵌经过校验的 Replay 副本、JS、CSS 与必要素材，不通过 `file://` 再请求其他文件；
- HTML 中显示的 Replay hash 必须与外部 `replay.json` 一致；
- 固定资源顺序，不写构建时间戳，不依赖远程资源；相同 Replay、源码和锁文件应生成字节一致的 HTML；
- 不持有模型 API Key；
- 不在浏览器中运行 Agent 或 LLM；P0.5 Enrichment 必须预先生成；
- 通过单一 `visibleThroughDay` 派生所有页面状态；
- Replay 校验失败时停止展示并给出明确错误；
- P0 不需要数据库、账号系统或服务端渲染。

Direct Model 的 API Key 只从环境变量或本机密钥存储读取，不写入 MatchConfig、日志、Replay 或前端包。正式验收必须保存脱敏的 Provider Probe 结果摘要。Probe 与正式比赛的原始请求/响应由同一个显式诊断开关控制，代码和 `.env.example` 默认关闭，只有操作者在本地明确启用时才写入独立、Git 忽略的诊断目录；实现过程不得修改真实 `.env`。诊断需移除 Authorization、API Key、Cookie、Bearer 和嵌套凭据字段，同时保留其他诊断所需的请求/响应正文。当前本地开发不做自动清理；Replay 仍只保存结构化事实，原始交换不属于 Replay hash。

## 19.4 建议目录

```text
src/
├── core/
│   ├── game-environment.ts
│   ├── rulesets/
│   ├── actions/
│   ├── observation/
│   ├── settlement/
│   ├── random/
│   │   ├── seeded-rng.ts
│   │   └── random-streams.ts
│   └── event-log/
│       ├── event-types.ts
│       ├── event-writer.ts
│       └── state-diff.ts
└── adapters/
    └── legacy-mcp-server.ts       # legacy；P0 不扩建

benchmark/
├── suites/
├── baselines/
└── reports/

arena/
├── configs/
│   ├── scenarios/
│   ├── personas/                 # P1
│   ├── match-presets/
│   └── commentary-styles/        # P0.5
├── runner/
│   ├── match-runner.ts
│   ├── episode-runner.ts
│   ├── agent-driver.ts
│   ├── direct-model-driver.ts
│   ├── scripted-driver.ts         # 仅内部确定性回归
│   ├── provider-adapters/
│   └── timeout-policy.ts
├── events/
│   ├── global-event-engine.ts
│   ├── personal-event-engine.ts
│   └── event-scheduler.ts
├── replay/
│   ├── replay-builder.ts
│   ├── replay-schema.ts
│   └── replay-validator.ts
├── diagnostics/
│   ├── probe-summary.ts
│   └── raw-exchanges/             # Git 忽略；显式开关
└── enrichment/                    # P0.5；与 Runner 隔离
    ├── interview-runner.ts        # 例外：赛后调用选手原模型
    ├── provider-config.ts         # 通用独立第六模型配置
    ├── director/
    │   ├── highlight-detector.ts
    │   ├── importance-score.ts
    │   ├── act-builder.ts
    │   ├── turning-points.ts
    │   └── prediction-evidence.ts
    ├── commentary/
    │   ├── fact-builder.ts
    │   ├── narrator.ts
    │   ├── validator.ts
    │   ├── templates/
    │   └── versions/
    ├── awards/
    │   ├── award-engine.ts
    │   └── rules/
    ├── endings/
    │   ├── ending-engine.ts
    │   └── ending-writer.ts
    └── enrichment-schema.ts

web/
├── dashboard/
├── replay-state/
├── charts/
├── event-cards/
└── terminal/
```

## 19.5 分发、许可证与来源记录

当前仓库根目录声明 GNU GPL v2。Arena 若作为该项目的衍生版本对外分发，应在发布前单独完成许可证审查，至少确认源码提供方式、修改说明、版权与免责声明展示、依赖许可证清单。这里记录的是发布门槛，不替代正式法律意见。

每个离线包同时生成 `asset-manifest.json`，记录：

```text
文件名
SHA-256
来源或生成方式
许可证
作者/模型
生成提示词与 seed（如适用）
人工修改说明
是否允许公开传播
```

模型厂商名称仅作为事实配置展示，不默认使用其 Logo 或拟人化形象。模型生成文案、Image Gen 素材和第三方音效在公开传播前还需分别核对供应商条款与素材许可。

---

## 20. 核心数据结构

## 20.1 Match 配置

```ts
interface MatchConfig {
  matchId: string;
  rulesetVersion: string;
  toolSchemaVersion: string;
  rngVersion: string;
  settlementRuleVersion: string;
  scenarioId: string;
  seed: number;
  maxDays: number;
  maxDecisionCallsPerAgent: number;
  maxToolCallsPerAgent: number;
  maxOutputTokensPerCall: number;
  decisionTimeoutMs: number;
  totalWallClockMs: number;
  strictBenchmark: boolean;
  agents: [AgentEntry, AgentEntry, AgentEntry, AgentEntry, AgentEntry];
  slotRotation: {
    enabled: boolean;
    rotationIndex?: number;
  };
  contextPolicy: {
    strategy: "program_summary_plus_recent_tools";
    summaryVersion: string;
    observationVersion: string;
    neutralPromptVersion: string;
    neutralPromptHash: string;
    maxSummaryCharacters: number;
    recentToolCalls: number;
  };
  diagnostics: {
    saveProbeSummary: true;
    saveRawExchanges: boolean;
    rawExchangeDirectory?: string;
  };
}

interface AgentEntry {
  id: string;
  driver: "direct";
  provider: string;
  model: string;
  modelRevision: string | "unavailable";
  providerAdapterVersion: string;
  samplingParameters: Record<string, unknown>;
  slot: number;
}
```

P0 配置校验器必须确保恰好五个 Agent、五组 `Provider + model` 组合互不重复、预算一致，并拒绝跨局记忆、人格 Prompt、非 Direct driver 和 legacy 工具。slot 轮换是显式可配置能力；关闭时保持当前 slot，开启时按版本化规则轮换。UI 身份由 `provider + model` 派生，不单独配置展示名。

P0.5 通用生成另用独立配置：

```ts
interface ReplayEnrichmentConfig {
  sourceReplayPath: string;
  sourceReplayHash: string;
  enrichmentVersion: string;
  generalGenerator: {
    provider: string;
    model: string;
    adapterVersion: string;
  }; // Provider + model 不得与五个 Runner 配置重复
  interviews: {
    enabled: boolean;
    days: number[];
    promptVersion: string;
    useOriginalContestantModels: true;
  };
}
```

## 20.2 Episode Trace

P0 的五个 Direct episode 产出同一种 episode 轨迹，再由 Match Assembler 合并：

```ts
interface EpisodeTrace {
  schemaVersion: string;
  episodeId: string;
  rulesetVersion: string;
  toolSchemaVersion: string;
  rngVersion: string;
  settlementRuleVersion: string;
  scenarioId: string;
  seed: number;
  agentSlot: number;
  driver: "direct";
  initialStateHash: string;
  events: ArenaEvent[];
  finalResult: FinalResult;
  traceHash: string;
}
```

`traceHash` 只覆盖规范化、确定性的字段。Provider 请求时间、墙钟时间和本机路径等运行元数据写入单独的 Run Report，不进入确定性事件链。Scripted 内部回归可复用等价的测试 Trace 类型，但不改变产品契约。

## 20.3 事件日志

```ts
interface ArenaEvent {
  id: string;
  matchId: string;
  episodeId: string;
  agentId: string;
  day: number;
  sequence: number;
  type: string;
  observationHash?: string;
  fullContextHash?: string;
  modelCallId?: string;
  action?: {
    tool: string;
    arguments: Record<string, unknown>;
  };
  stateBefore?: GameStateSnapshot;
  stateAfter?: GameStateSnapshot;
  stateDiff?: Record<string, unknown>;
  result?: Record<string, unknown>;
  relatedGlobalEventId?: string;
  sourceRandomStream?: string;
}
```

事件 ID 必须由 match、episode、day 和 sequence 等稳定字段派生，不使用当前时间或随机 UUID。

## 20.4 Replay

```ts
interface ArenaReplay {
  schemaVersion: string;
  matchId: string;
  rulesetVersion: string;
  toolSchemaVersion: string;
  rngVersion: string;
  settlementRuleVersion: string;
  scenarioId: string;
  seed: number;
  sourceTraceHashes: string[];
  agents: ReplayAgent[];
  days: ReplayDay[];
  finalRanking: RankingEntry[];
  metrics: MatchMetrics;
  competitionAudit: CompetitionAudit;
  presentation: {
    defaultVisibleThroughDay: 1;
    terminalUnlockDay: 40;
    autoplayEnabled: false;
  };
  integrity: {
    eventLogHash: string;
    configHash: string;
    factLayerHash: string;
    replayBuilderVersion: string;
  };
}
```

事实 `ArenaReplay` 不包含 `acts`、`highlights`、`interviews`、`awards`、`endings` 或 `commentarySets`。P0.5 使用独立契约：

```ts
interface ReplayEnrichment {
  schemaVersion: string;
  enrichmentVersion: string;
  sourceReplayHash: string;
  acts: ReplayAct[];
  highlights: ReplayHighlight[];
  interviews: PublicInterview[];
  awards: MatchAward[];
  endings: AgentEnding[];
  commentarySets: CommentarySet[];
  enrichmentHash: string;
}
```

`enrichmentHash` 独立于 `factLayerHash`。创建、重试、切换或删除 Enrichment，不得改变来源 Replay 的任何字节、排名、事实 hash 或 Runner 报告。

## 20.5 Replay Day

```ts
interface ReplayDay {
  day: number;
  publicMessages: InformationItem[];
  publicEventIds: string[];
  agentEventIds: Record<string, string[]>;
  rankings: RankingEntry[];
  fiveDayUnit: number;
}
```

墙钟时间只存在于独立 Run Report，因此同一规范化输入可以得到相同的事实 hash 和 trace hash。Run Report 还必须逐请求记录完整上下文 hash、model revision、sampling parameters、输入/输出 Token、延迟、请求与 action 的关联以及平台/Provider/模型/协议等故障归属；金额费用固定为不估算。

---

## 21. 后台运行流程

P0 Runner 流程：

```text
读取 MatchConfig
    ↓
校验五组 Provider + model 互不重复且预算一致
    ↓
并行执行五次 Provider Probe，保存脱敏摘要
    ↓
加载 scenario 与随机流
    ↓
为五个 Agent 创建独立 episode
    ↓
五个 Direct Model Driver 受控运行，最长 40 天
    ↓
记录请求、动作、结果、状态快照、state diff 与审计字段
    ↓
完成所有 episode 与统一终局结算
    ↓
按日期合并五条轨迹
    ↓
计算排名、曲线、风险与工具指标
    ↓
输出 Trace、replay.json、run-report.json 与自包含 replay.html
    ↓
前端离线加载，从第 1 天按游标逐日揭示
```

P0.5 Replay Enrichment 流程完全独立：

```text
显式读取并验证既有 replay.json
    ↓
冻结 sourceReplayHash，不调用或重跑 Runner
    ↓
程序化检测高光、关键转折、奖项、运气标签与结局
    ↓
可选：使用独立第六模型生成通用文案
    ↓
可选：分别调用五位选手原模型生成赛后无状态采访
    ↓
校验全部证据引用与事实边界
    ↓
输出独立 Enrichment Artifact / Enrichment Report / enriched HTML
```

任一 Enrichment 步骤失败时，已有 P0 JSON、Trace、Report 和 HTML 必须保持可用。下一场 Runner 也不得读取任何 Enrichment 产物。

---

## 22. Agent 故障与兜底

## 22.1 工具错误

- 单次无效调用：返回标准错误；
- 连续两次同类无效调用：返回一次中性格式提醒；
- 连续超过阈值：跳过当前决策或执行配置中的安全空动作；
- 错误记录进入 Replay 和 Run Report；P0.5 可据此生成工具类标签。

中性提醒只能说明接口错误，不提供策略建议。

## 22.2 重复循环

检测：

- 相同工具和参数连续重复；
- 同一状态下反复查询；
- 同日无意义买卖循环；
- 无状态变化的长序列行为。

达到阈值后：

1. 记录 `loop_detected`；
2. 返回一次工具使用提醒；
3. 再次循环则终止该 episode 或推进时间；
4. 其他 Agent 继续运行。

## 22.3 超时与中断

单个 Agent 超时不得阻塞 Match。

记录状态：

```text
completed
terminated
bankrupt
dead
tool_limit
model_timeout
loop_terminated
runtime_error
```

中途结束的 Agent 仍保留完整事实卡片和报告。游戏内死亡按规则参与终局分组；技术 DNF 不授予正式名次，也不参与 P0.5 幸运/倒霉评选。

## 22.4 Replay Enrichment 失败

P0.5 的程序化加工、通用第六模型、选手原模型采访或解说失败时，不重新运行游戏，不修改事实 Replay。可以使用程序模板、记录该项失败或只输出部分 Enrichment。

---

## 23. MVP 范围

## 23.1 P0：必须完成

| 模块 | 交付内容 |
|---|---|
| 核心环境 | 从 MCP 入口抽出 `GameEnvironment`，完成版本化规则、统一终局结算和命名随机流 |
| Direct-only 契约 | 五个 Direct Agent 共用 Observation、Action、校验器、事件日志和版本化中性 Prompt |
| 五模型 Match Runner | 一条命令以同一 scenario、seed 和预算运行 5 个独立 Agent；五组 `Provider + model` 不得重复 |
| Provider Probe | 正式比赛前并行请求五组配置，严格验证 Action 并保存脱敏 Probe 摘要 |
| 结构化日志 | action、before、after、diff、随机流来源、完整上下文 hash、模型调用与证据 ID |
| 上下文契约 | `full-history-v1`：当前无身份 Observation + 本局此前全部 action/result/effects/state diff；不摘要、不截断，禁止跨局记录 |
| 运行审计 | model revision、sampling、总墙钟、请求-action 关联、故障归属、输入/输出 Token 和延迟；不估算金额 |
| Replay | 生成、校验并 hash 只含结构化事实的 `replay.json`，不混入叙事字段 |
| 单一观众看板 | 第 1～40 天日期游标、五模型状态、完整动作、排名、曲线、事件、DNF 与核心终局 |
| 离线交付 | 同时输出 `replay.json` 与可双击打开的自包含 `replay.html`，断网完整可用 |
| 故障与密钥边界 | 单 Agent 失败不阻塞整场；模型 Key 不进入 Replay；原始交换由独立开关和 Git 忽略目录管理 |
| slot 轮换 | 作为版本化可配置能力保留，单场是否启用写入 MatchConfig |
| 自动浏览器验收 | 使用任意等价工具重复验证防剧透、Day 40、DNF、离线和无远程请求 |
| Benchmark 埋点 | 记录未来多 seed 聚合所需的表现、风险、可靠性、Token 和延迟，但 P0 不做公开榜单 |

P0 明确不做：程序化高光、采访、奖项、结局、娱乐解说、自动播放、动态幕、图片分享卡、人格杯、多世界线、手机专用界面、strict MCP、MCP Host 编排、成套 Image Gen 素材和公开模型榜单。Scripted 不属于产品范围或 P0 验收，只保留内部回归工具。

## 23.2 P0.5：独立 Replay Enrichment

- 建立独立 Enrichment Schema、Enrichment Report 和来源 Replay hash 引用，绝不回写事实 Replay；
- 先实现 8 类程序化、证据驱动的高光和导演筛选的关键事件横向对比，再按需扩展到 16 类；
- 通用 LLM 生成使用与五个 Runner 配置均不重复的独立第六模型配置；
- 赛后采访例外使用每位选手原模型，以该选手截至对应日期的事实结果为上下文，并使用全新无状态 session；
- 实现程序化奖项、结局和运气标签；技术 DNF 不参加最幸运/最倒霉；
- 可选生成 3～6 个动态幕与揭示安全的章节书签；
- 解说 Prompt 编辑、抽样预览、全量重生成和版本切换；
- 单 Agent 战况卡、高光事件卡、终局战报卡三种本地出图；
- 对一批 Replay 做事实准确性、内容重复率和线下观看效果复盘。

## 23.3 P1：产品化

- 自动播放、自动节奏与 60～90 秒精华回放；
- 多 scenario、多 seed 聚合榜单和五维雷达图；
- 人格杯、命名世界线和每周固定世界线；
- 公共消息、地点传闻、付费消息和 NPC 结构化事件扩写；
- 商品、地点、NPC、人格与结局的完整视觉素材；
- 高光、排名反转和终局音效；
- 手机浏览适配；
- 更多 Direct Model Provider Adapter；
- strict MCP Adapter 与外部 Host episode；
- 自动拉起或连接外部 MCP Host 的进程桥；
- Agent 单人故事页和更多分享卡样式。

## 23.4 P2：扩展（冻结）

- 用户提交 Agent；
- 自定义人格；
- 观众选择下一场公共世界线；
- 多人实时观看；
- 自动配音和视频导出；
- 赛季排行榜；
- Agent 间交易或合作；
- 共享市场模式。

Agent 间直接交互和共享市场不得进入 P0。公开发布、公开榜单和线上服务不在近期目标；当前交付面向本地研究、线下展示和私有仓库协作。

---

## 24. Codex 实施顺序

## 阶段 0：冻结 Direct-only 规则与五模型配置契约

1. 冻结 `rulesetVersion`、`toolSchemaVersion`、Observation、Action 和终局结算；
2. 冻结 `neutral-v1` 或后续版本化中性 Prompt 及其 hash；
3. 明确五个 Runner 配置和独立第六 Enrichment 配置的环境变量命名与唯一性校验；
4. 将 Scripted 标记为内部回归，将 strict MCP 标记为 P1；
5. 建立规则差异、内容边界和本地展示免责声明。

交付标准：产品入口只剩五模型 Direct；任何配置、文档和完成声明均不再把 Scripted、MCP 或叙事写成 P0。

## 阶段 1：确定性核心与内部回归

1. 保持纯 `GameEnvironment`、版本化 seeded RNG、命名随机流和统一终局；
2. 保证查询和无效调用不改变随机序列；
3. 维护不可变状态快照、diff、稳定事件 ID 与事实 hash；
4. 保留 Scripted Driver 仅用于内部确定性 fixture 和故障回归；
5. 对核心公式和边界建立自动化测试。

交付标准：相同 ruleset、seed 和固定动作轨迹产生逐字节一致的状态与事件日志；对外不宣称 Scripted 是产品模式。

## 阶段 2：五 Provider 配置与 Probe

1. 完成五组 Direct Provider 配置和协议适配；
2. CLI 强制五组 `Provider + model` 组合互不重复；
3. 五个 Probe 并行各请求一次，无自动重试且全部尝试；
4. 严格解析并在独立初始环境执行一次 `GameAction`；
5. 正式验收保存脱敏 Probe 摘要；
6. 原始交换由开关写入独立 Git 忽略目录，代码和 `.env.example` 默认关闭；实现过程不修改真实本地 `.env`。

交付标准：Probe 不启动比赛、不写比赛产物；五家全部通过后才允许显式开始正式比赛。

## 阶段 3：五模型 Match Runner 与完整审计

1. 创建五个隔离 episode；
2. 实现受控并发、统一决策/动作/输出预算、单次超时、总墙钟和错误隔离；
3. 实现 `full-history-v1` 全历史上下文和覆盖实际完整发送内容的上下文 hash；
4. 记录 model revision、sampling parameters、输入/输出 Token 和延迟；
5. 建立每个请求与 action 的逐条关联；
6. 区分平台、Provider、模型、协议和 Runner 故障归属；
7. 实现可配置、版本化 slot 轮换。

交付标准：一条命令完成五模型 Direct 比赛；任意一个 Agent DNF 时，其余 Agent 继续，报告如实记录且不伪装为正常名次。

## 阶段 4：事实 Replay、Trace 与 Run Report

1. 按日期和 sequence 合并五条 episode 轨迹；
2. 计算日估值、暂定排名、核心终局排名、债务、健康和可靠性指标；
3. 定义事实 Replay Schema、迁移策略和 Validator；
4. 保存事实 hash、配置 hash、Trace hash 和证据引用；
5. 输出 `replay.json`、Episode Trace 与 `run-report.json`；
6. 确保 Replay 不包含采访、高光、奖项、结局或娱乐解说字段。

交付标准：Replay 可从 Trace 稳定重建，所有数值与排名可独立重算；Run Report 不估算金额费用。

## 阶段 5：事实观众页、离线包与自动浏览器验收

1. 建立 `VisibleReplaySlice` 和全局日期游标；
2. 完成五模型 `Provider + model` 身份、状态、完整动作、结果、曲线和公共事件；
3. 完成 DNF 占位、故障分类、退出日和 Day 40 核心终局；
4. 生成与 `replay.json` hash 对应的自包含 `replay.html`；
5. 使用 Playwright、浏览器控制或等价工具重复验证 Day 1～39 防剧透、Day 40、弹窗、ARIA、键盘、断网和无远程请求；
6. 在 1920×1080 和 1366×768 环境验收。

交付标准：任何人双击 HTML 即可从第 1 天逐日查看事实，页面没有模拟或 Enrichment fallback。

## 阶段 6：P0 真实验收

1. 每场先完成五 Provider Probe 并保存脱敏摘要；
2. 使用 Direct 模式完成至少 3 场五模型真实样例；
3. 每场产出 Replay、Trace、Run Report 和单文件 HTML；
4. 执行 §25 全量自动化测试和可重复浏览器验收；
5. 审查完整上下文 hash、request-action 关联、Token、延迟、故障归属和原始交换脱敏；
6. 如实接受游戏内死亡和技术 DNF，不把“零 DNF”或“全员活到 Day 40”设为硬门槛；任何异常必须留有足够事实供人工判断。

交付标准：至少 3 场真实 Direct 金样满足 §26；不需要 Scripted 金样或 strict MCP episode。

## 阶段 7：P0.5 独立 Replay Enrichment

1. 定义独立 Enrichment Schema、Report、hash 和证据引用；
2. 先实现程序化高光和导演筛选的关键事件横向对比；
3. 增加奖项、结局和幸运/倒霉规则，排除技术 DNF；
4. 配置不与五个 Runner 配置共用的第六模型做通用生成；
5. 采访在赛后分别调用选手原模型的全新无状态 session；
6. 验证任一 Enrichment 的启用、失败、重试和删除都不改变事实 Replay 或下一场 Runner。

交付标准：Enrichment 可从既有 Replay 单独重建，不调用 Runner，不改变 `factLayerHash`。

## 阶段 8：P1 strict MCP 与远期能力

strict MCP Adapter、外部 Host episode 和 MCP Host 编排必须在 P0/P0.5 稳定后独立规划。自动播放、人格杯、多世界线、手机专用体验、分享卡和公开榜单不进入当前待办。

---

## 25. 测试要求

## 25.1 核心确定性与随机流测试

- 相同 ruleset、seed 和动作轨迹产生相同状态、事件 ID、diff 与终局；
- 公共随机流在五个 Agent 间一致，个人随机流按 slot 隔离；
- 查询次数和无效调用变化不影响市场与事件；
- P0.5 Enrichment 和前端运行次数不影响游戏结果或事实 hash；
- Replay 可从日志稳定重建；
- 每条命名随机流都有固定测试向量，算法升级必须提升 `rngVersion`；
- 模型新鲜调用本身不承诺逐字确定；可复现承诺针对固定配置和已记录动作轨迹，模型 revision、采样参数与输入 hash 另行留档。

## 25.2 五 Provider、Probe 与预算测试

- CLI 拒绝少于或多于五组 Runner 配置，并拒绝重复的 `Provider + model` 组合；
- 五个 Agent 使用相同中性 Prompt hash、Observation Schema、初始事实、动作预算、超时和输出上限；
- Probe 每组恰好一次请求、无自动重试、失败后仍尝试其余配置；
- Probe 不运行完整比赛，不创建 Replay、Trace 或 Run Report；
- 三类 Provider 协议的 JSON mode、Token 参数、usage 归一化和脱敏错误均有契约测试；
- 单 Provider 故障只使对应 Agent 技术 DNF，其余四个 episode 继续；
- slot 轮换关闭时映射稳定，开启时按版本化配置轮换且不改变公共事实。

## 25.3 信息、上下文与 Replay Enrichment 隔离测试

自动检查 Agent 每次输入，确保不包含：

- 动态幕标题和导演标签；
- 其他 Agent 状态、排名或动作；
- 未来事件和未来终局收购价；
- 前轮 Replay、采访、观众解说、奖项条件或结局提示；
- 跨局 `game_records` 或模型个人记忆。

同时验证：

- 第六次及后续请求仍包含本局此前全部 action、result、effects 和 state diff，且不包含旧 Observation；
- 完整上下文 hash 覆盖系统指令、当前 Observation 和全部历史事实，并可由产物独立重算；
- 下一场 Runner 使用全新 session，不读取任何前轮事实结果或 Enrichment；
- 通用 Enrichment 第六模型配置与五组 Runner 的 `Provider + model` 均不重复；
- P0.5 采访使用选手原模型的新 session，只包含该选手截至采访日的事实；
- 采访输出不写回事实 Replay 或 game memory，失败不阻塞 P0 产物；
- 开启、关闭、重试或删除 Enrichment 时，事实 Replay、Trace、排名和 hash 完全一致。

## 25.4 事实 Replay 与 P0.5 Enrichment 测试

- Replay Schema、配置 hash、事实 hash 与所有证据 ID 有效；
- 日估值、排名、回撤和终局结果可独立重算；
- P0 Replay Schema 中不存在采访、高光、奖项、结局或解说字段；
- Day 1～39 暂定排名使用公开参考价，Day 40 正式排名逐项等于核心 `finalRanking`；
- Run Report 的请求数、有效/无效动作、超时、DNF、输入/输出 Token、延迟和故障归属可与 Trace 对账；
- P0.5 高光、奖项、结局和运气标签均可从事实 Replay 重算且证据完整；
- 技术 DNF 不参与最幸运/最倒霉评选；
- 解说中的数值、商品、地点、人物和事件均来自事实对象；
- LLM 失败或校验失败时回退程序模板或省略内容，不影响 P0 产物；
- 动态幕只在所有 episode 完成后生成，每幕至少一个证据事件。

## 25.5 前端日期边界与防剧透测试

对 `visibleThroughDay = 1…39` 参数化检查：

- 五模型卡片、排名、曲线、事件流、对比卡和详情不读取未来数据；
- 未来事件标记、Tooltip、弹窗、搜索结果和 ARIA 文本不进入渲染树；
- P0.5 预测对账只在 `targetDay` 到达后显示；
- 终局标签在第 40 天前锁定，最终排名不可通过正常交互看到；加载 Enrichment 时奖项和结局同样锁定；
- 跳转到未来日期的按钮明确表达“揭示”，跳转后所有面板使用同一日期；
- 中途出局 Agent 保持占位，出局后没有伪造动作；
- 加载任何 P0.5 Enrichment 时仍使用同一 `VisibleReplaySlice`。

## 25.6 估值与终局结算测试

- 同场所有 Agent 对同一商品使用相同日估值价和终局收购价；
- 流动性折扣按 scenario 配置生效；
- Agent 最后所在地和最后一次看到的局部价格不影响终局估值；
- 终局只执行一次，重复 finalize 幂等；
- 终局后所有交易和移动动作被拒绝；
- 现金、存款、库存、债务和未结费用之和与最终净资产一致。

## 25.7 故障、安全与离线测试

- 单 Agent 超时、工具循环、运行错误和上下文超限；
- 五 Provider Probe 失败、比赛请求失败、P0.5 采访/解说失败和 Provider 限流；
- Replay 缺字段、hash 不匹配、证据悬空和不支持的 Schema 版本；
- API Key、Authorization Header、Cookie 和原始密钥不得出现在日志、Probe 摘要、Replay、HTML 或脱敏原始交换中；
- 原始交换开关关闭时不创建诊断正文；开启时只写独立 Git 忽略目录，Replay hash 不受影响；
- 浏览器网络请求被全部拦截时，`replay.html` 仍可从第 1 天浏览到终局；
- HTML 内嵌 Replay hash 与外部 JSON 一致；
- 页面刷新后默认回到第 1 天，不通过本地缓存意外保留终局揭示状态。

## 25.8 内容与可读性测试

- 当前 37 条基础随机事件全部有稳定 ID、分类、作用域和证据字段；
- 投影分辨率下关键数字、图例、Agent 身份和警报可辨认；
- 不使用颜色作为唯一状态信号；
- 同一模板连续重复时能被内容复盘报表识别；
- 涉及盗版、走私、假酒、暴力、地域和身份刻板印象的文案完成时代语境与传播审查。

---

## 26. P0 验收标准

### 26.1 五模型 Direct Runner

- 一条命令可以通过 Direct 模式完成一场五 Agent 比赛；
- 五组 `Provider + model` 配置均完整且互不重复；
- 五个 Agent 使用相同 scenario、seed、初始条件、规则、中性 Prompt、Observation、工具预算、输出上限、超时和上下文策略；
- 公共环境一致，个人行为事件按状态和独立随机流分化；
- Provider、model、slot 和审计身份不进入模型决策 Prompt；
- 查询和任何赛后 Enrichment 不改变游戏随机序列；
- 终局使用统一收购价自动结算且只结算一次；
- 单个 Agent 失败不阻塞其他 Agent。

### 26.2 公平、隔离与安全

- 每次模型输入均符合固定 Observation 和上下文契约；
- Agent 上下文中不存在其他参赛者、未来事件、导演标签、奖项或叙事阶段；
- 下一轮 Runner 不读取任何前轮结果、采访或叙事；
- Provider、model revision、采样参数、Prompt hash、完整上下文 hash、输入/输出 Token 和延迟均有记录；
- 总墙钟、请求与 action 关联以及故障责任归属可审计；
- P0 不估算金额费用；
- API Key 和 Authorization Header 不出现在 MatchConfig、日志、Replay 和 HTML。

### 26.3 事实 Replay、Trace 与报告

- 所有有效动作都有 action、before、after、diff 和证据 ID；
- Replay 通过 Schema、数值、引用和 hash 校验，可从日志稳定重建；
- Replay 只含结构化事实，不包含采访、高光、奖项、结局或娱乐解说；
- 每个 Agent 的 Provider、model、adapter version、请求、动作、DNF 和退出日准确；
- Run Report 至少包含总计和逐 Agent 的请求成功/失败/超时、有效/无效动作、DNF、故障类别、输入/输出 Token 和延迟统计；
- 正式验收保存五 Provider 的脱敏 Probe 摘要；
- 原始交换诊断遵守显式开关、脱敏和 Git 忽略目录边界；
- P0 不生成幽灵线，也不展示未执行策略的模拟收益。

### 26.4 单一观众看板

- `replay.html` 可在断网环境双击打开，不发出运行时网络请求；
- 页面默认从第 1 天开始，五日刻度只用于导航；
- 日期游标控制卡片、排名、曲线、事件、弹窗、Tooltip、ARIA 和详情；
- 第 40 天前无法通过正常交互看到最终排名；
- Day 1～39 明确标注为公开参考价暂定排名，Day 40 直接采用核心统一结算排名；
- 支持逐日和直接输入日期，跳转后所有区域日期一致；
- 支持五 Agent 同日横向对比，以及资产、债务、健康和排名曲线；
- UI 只用 `Provider + model` 作为文字身份，不显示 A/B/C/D/E 或策略化名称；
- 中途出局 Agent 保持灰化占位并显示真实出局日期和类型；
- 1920×1080 与 1366×768 下无需缩放即可看清关键数字；
- 镜像投屏与电脑显示完全相同，不存在隐藏界面或角色权限；
- 相同 Replay 在支持的浏览器中呈现相同事实与终局结果。
- 使用不限品牌的自动浏览器工具可重复完成上述验收。

### 26.5 P0 金样

- Direct 模式至少完成 3 场五 Agent 真实样例；
- 每场均产出 `replay.json`、Episode Trace、`run-report.json`、`replay.html` 和脱敏 Probe 摘要；
- 技术 DNF 和游戏内死亡均如实记录并有足够证据供人工判断；
- 不要求零技术 DNF，也不要求五个 Agent 全部存活到 Day 40；
- Scripted 金样和 strict MCP episode 不属于 P0 验收。

---

## 27. P0.5 Enrichment 内容与文案规范

本章不属于 P0 Runner 验收。P0 只需要准确、清楚的事实动作、结果、状态、错误和 UI 系统文案；本章的市井解说、采访、高光、奖项和结局均由独立 Replay Enrichment 生成或计算。

### 27.1 语气

整体采用市井、荒诞、轻讽刺的比赛解说风格。

解说可以夸张表达情绪，但不能夸大或篡改事实。

内容节奏采用“三层密度”：

- 普通动作只说清发生了什么，不强行抖包袱；
- 高光事件使用一句有记忆点的调侃，再跟一句可核对的事实；
- 终局允许更完整的回顾，但必须明确区分本场结果与长期能力。

推荐句式：

```text
看起来，某模型把安全感暂时寄存在了 120 张 VCD 里。
事实是：该模型在第 8 天用 83% 的可用现金完成买入。
```

第一句是带保留的娱乐解读，第二句是可审计事实。不得省略这种边界后把解读写成事实结论。

### 27.2 禁止内容

- 不展示内部思维链；
- 不编造日志中不存在的行为；
- 不把模型公开采访当作真实心理；
- 不提前泄露未来事件；
- 不用章节标题指导 Agent；
- 不因节目效果修改已经发生的结果；
- 不将失败 Agent 从回放中删除；
- 不用模糊措辞掩盖工具错误或运行失败；
- 不把违法、灰色交易题材写成现实操作建议或价值背书；
- 不用地域、职业、性别、疾病或身份刻板印象制造针对现实群体的笑点；
- 不使用模型厂商商标、真人肖像或未经授权的角色形象充当 Agent 素材。

### 27.3 事实与风格分层

每条内容分为：

```text
事实：程序生成，可审计
风格：LLM 润色，可替换
证据：事件 ID，可回看
```

### 27.4 内容生产清单

| 内容包 | 数量或覆盖范围 | 交付物 | 验收重点 |
|---|---|---|---|
| 开场与规则 | 1 套开场、1 套规则摘要、核心指标 Tooltip | `onboarding.*` | 90 秒内能看懂目标、日期游标和终局规则 |
| 动作字幕 | 所有核心 Action 的成功、失败与合并态 | `action.*` 模板 | 有效动作覆盖率 ≥90%，金额和数量不丢失 |
| 现有事件整理 | 18 市场 + 12 健康 + 7 现金事件 | 稳定 ID、分类、改写稿、敏感标签 | 机制不被文案改写，时代语境可说明 |
| 高光文案 | 8 类 P0.5 核心高光，每类标题、短句、事实说明各 1 套 | `highlight.*` | 阈值来自 Enrichment 规则，标题不泄露未来 |
| 采访 | 5～35 日固定问题、终局问题、字段错误提示 | Prompt + Schema + fallback | 跨场一致、可验证预测、自由发言不过长 |
| 预测对账 | 命中、低于、高于、商品判断正反四类结果 | `prediction.*` | 数值差额和证据准确，目标日前隐藏 |
| 奖项 | 10 个 P0.5 首批奖项 | 标题、规则说明、颁奖短句 | 可重算、不保证人人获“好奖” |
| 结局 | 6 类基础结局 | 名称、事实模板、短摘要 | 不补写比赛后人生，不混淆单场与能力 |
| 故障与出局 | 7 种运行状态及恢复说明 | `status.*` | 坦白技术失败，不伪装成剧情死亡 |
| UI 系统文案 | 加载、空态、锁定、跳日、校验失败、离线说明 | `ui.*` | 短、清楚、投影可读，不使用后台术语 |
| 合规框定 | 年代背景、虚构声明、单场结果声明 | 固定页脚与开场说明 | 公开传播时不把题材和结果误读为现实建议或模型定论 |

P0.5 可在首批内容稳定后再扩写 8 类高光、10 个奖项、动态幕和解说版本。内容扩写不得早于事实 Replay 契约稳定和现有 37 条事件的结构化审查。

### 27.5 文案数据与审核流程

文案不散落在组件和规则代码中。建议统一结构：

```ts
interface CopyEntry {
  id: string;
  locale: "zh-CN";
  template: string;
  factBindings: string[];
  maxLength: number;
  tone: "neutral" | "playful" | "warning";
  sensitiveTags: string[];
  version: string;
  reviewStatus: "draft" | "fact_checked" | "approved";
}
```

每批文案依次通过：

1. **事实检查**：字段、数字、因果和证据是否成立；
2. **趣味检查**：是否有节奏、反差和角色感，是否每句都在重复同一种梗；
3. **敏感与时代语境检查**：是否涉及违法题材、伤害、歧视、商标或真人；
4. **投影可读性检查**：长度、字号、断行和同屏信息量是否合格；
5. **Replay 抽样检查**：至少用普通局、暴富局、失败局各一场验证。

公开传播前增加一轮独立审查。原版事件文本可以作为机制来源和时代素材，但不自动获得 Arena 展示文案的免审资格。

---

## 28. 示例观看流程

以下是加载 P0.5 Enrichment 后的历史示意，不是 P0 硬功能或固定剧情。正式页面中的每个数字、商品和结果都必须来自当前 Replay；身份必须替换为真实 `Provider + model`，不能使用 A/B/C/D/E 或策略人格。

### 第 1 天：交代规则

```text
五位 Agent 带着同样的 2,000 元现金和 5,000 元债务进入北京。
他们面对同一个市场，但不会看到彼此的选择。
日期游标从第 1 天开始，终局将在第 40 天解锁。
```

### 第 5 天：第一次公开立 flag

```text
某位选手在赛后生成的第 5 天采访截面中，预测第 10 天净资产会落在 12,000～16,000 元，并把盗版 VCD 列为最看好的商品。
这不是策略承诺，只是一条将在第 10 天自动对账的公开预测。
```

### 第 8 天：排名反转

```text
事实：某模型当天净资产增加 9,600 元，排名从第五升至第一。
解说：看起来，它暂时把安全感寄存在了一屋子光盘里。
```

### 第 10 天：预测对账

```text
第 5 天预测：12,000～16,000 元
第 10 天实际：8,400 元
结果：低于预测下限 3,600 元
解说：区间画得很宽，现实还是从下面绕了过去。
```

### 第 13 天：同一事件，五种后果

```text
公共事件：市场检查
Provider 甲 + Model 甲：已提前卖出，无直接库存损失
Provider 乙 + Model 乙：持有相关商品，损失 48 件库存
Provider 丙 + Model 丙：当天未持有该商品
Provider 丁 + Model 丁：episode 已因模型超时停止，保留技术退出状态
Provider 戊 + Model 戊：当天在其他地点，未受影响
```

技术退出必须照实显示，不能改写成“跑路”或“破产”。

### 第 40 天：主动揭晓终局

```text
P0 先显示最终排名和统一终局结算。若加载 P0.5 Enrichment，再逐项揭晓关键转折、奖项和结局。
某模型可以获得“京城首富”，同时也可能获得“村长重点关照对象”；好成绩不自动抹掉坏账。
```

### 结尾旁白

```text
有人赚得最多，有人最早还清债，也有人在工具循环里提前离场。
这只是这一条世界线的结果；村长只负责收债，不负责替模型写能力证明。
```

---

## 29. 首版开发结论

P0 只交付一个完整事实纵向闭环：五个不重复 `Provider + model` 的 Agent 通过 Direct 模式在同一世界线独立比赛；比赛产出确定性事件日志、Episode Trace、可审计 `replay.json`、`run-report.json`、脱敏 Probe 摘要和可双击打开的事实观众页。任何人都能从第 1 天逐日查看，并在第 40 天看到核心正式终局。

P0 的价值在于公平、真实和可审计的五模型同场对比。程序化高光、采访、奖项、结局和娱乐解说属于 P0.5 的独立 Replay Enrichment；它们可以增强线下观看，但不能成为 Runner 成功或事实 Replay 可用的前提。

P0 明确不建设演示者或个人准备功能，不生成幽灵线，不做自动播放、动态幕、分享卡、人格杯、多世界线、手机专用体验、strict MCP 或 MCP Host 编排，也不让视觉素材阻塞事实闭环。当前交付只面向本地研究、线下展示和私有仓库协作；公开发布和公开榜单不在近期范围。

所有叙事包装都建立在已经发生并固定 hash 的事实 Replay 之上。Agent 负责决策，环境负责规则，日志负责证据，P0 前端负责按日期安全揭示事实，P0.5 Enrichment 负责可删除、可重建的娱乐加工。下一场 Runner 永远从干净上下文开始。
