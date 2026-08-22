# Direct-only Arena v0：历史四模型纵向切片

> 状态：历史实现说明。本文记录 2026-08-21 已跑通的四槽 Direct-only 纵向切片，不再代表修订后的 P0 产品范围。新版 P0 是五个不同 `Provider + Model` 组合同时参赛，详见[项目进度台账](project-status.md)和[Direct Arena 运行说明](arena-direct.md)。

## 已完成的历史闭环

v0 实际完成的是：

```text
四组独立 Provider/模型配置
→ 四次 Provider Probe
→ 受控四模型真实比赛
→ replay.json / episode-traces.json / run-report.json
→ 自动生成单文件 replay.html
→ 第 1～40 天事实回放
```

核心 `GameEnvironment` 作为 Direct 比赛的事实核心。四个 Episode 相互隔离，公共市场共享 seed，个人随机按 slot 隔离。当前 `arena-schema-v2` Replay 包含 `competitionAudit`、Provider/model/adapter、技术失败分类、退出日、终局和历史版本的 `luckAudit`。

该闭环已经由 `run-001` 证明，但它只有四个模型，不能作为新版五模型 P0 的验收结果。历史 Replay、hash、报告和 HTML 不回填、不改写。

## 历史观众页事实范围

v0 观众页展示：

- Provider、模型和 adapter version，以及当前实现仍保留的槽位/展示身份；
- 当日每位 Agent 的完整动作序列与执行结果；
- 现金、存款、债务、健康、库存与净资产；
- 公共参考价格与公共事件；
- Day 1～39 按公开参考价计算的暂定排名及变化；
- 技术 DNF 类别和退出日；
- Day 40 直接来自核心 `finalRanking` 的正式排名；
- 个人随机事件计数、历史版本的最幸运/最倒霉结果和 Replay hash。

Day 1～39 的可见状态和导出不包含终局与运气数据。页面载入后移除原始注入节点，浏览器只回放事实，不调用模型。采访、预测对账、导演高光、奖项、人物结局和模型生成解说已从 v0 正式页面移除。

新版 P0 将参赛身份收缩为仅显示 `Provider + Model`；Runner 只保留随机事件原始计数，“最幸运/最倒霉”移入 P0.5 Replay Enrichment，技术 DNF 不参与候选。这些是未来目标，不是 v0 现状。

## 历史离线构建

在 2026-08-21 的历史四槽实现中，曾可从有效 Replay 显式重建：

```bash
npm run arena:replay -- --input /absolute/path/to/replay.json
```

上述命令描述当时的构建链。五模型首版曾切换到 `arena-schema-v3`；完成率改版后，当前正式构建器只接受 `arena-schema-v4` 五模型 Replay，并明确拒绝旧 schema/四模型输入。`run-001` 的 JSON、hash、报告和已有 HTML 继续保持原样，但不再保证由当前 `arena:replay` 重建。历史实现当时会校验 v2、四 Agent、40 天和 canonical `replayHash`，按固定顺序内联脚本、样式与本地资源，并拒绝远程运行时依赖。

## Scripted 的保留边界

Scripted 代码和命令仅保留为内部确定性回归工具。它不会静默进入正式页面，也不能作为真实模型、P0 产品或 MCP 验收证据。Scripted 已从产品范围、用户主流程、P0 验收和后续待办中移除。

正式前端没有 `sampleReplay` fallback；缺少或无法验证 Replay 时直接报错并停止展示。

## 历史测试与验收

v0 的离线测试曾覆盖中性 Prompt、无身份观察、三类 Provider 协议、usage 与错误脱敏、四请求 Probe 守卫、单 Provider DNF 隔离、报告聚合、Replay hash/排名/运气、正式前端失败关闭和 Day 1/39/40 可见性。

2026-08-21 完成过一次有明确配置边界的真实四模型验收，详见[历史真实验收记录](arena-direct-acceptance-2026-08-21.md)。该记录不保证未来账户、模型 ID、网关或配额可用，也不满足新版五模型 P0 至少 3 场 Direct 比赛和可重复自动浏览器验收的要求。

## 后续范围

- 新版 P0：五模型 Direct Runner、事实 Replay、五模型事实页面、完整审计字段、脱敏 Probe 摘要和可重复自动浏览器验收。
- P0.5：独立 Replay Enrichment，通用生成使用与五组 Runner `Provider + Model` 均不重复的第六模型配置；派生叙事绝不写回 Runner。
- P1：strict MCP。legacy MCP 保持历史入口，`StrictMcpEpisodePort` 仅为防止伪装已实现的接口占位。

当前交付目标仅为本地研究、线下展示和私有仓库协作，不包含公网托管或公开发布。
