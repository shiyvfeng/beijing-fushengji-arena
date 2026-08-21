# Direct-only Arena 首版交付边界

## 已实现的最小闭环

当前首版只验收 Direct Arena：

```text
四组独立 Provider/模型配置
→ 四次 Provider Probe
→ 受控四模型真实比赛
→ replay.json / episode-traces.json / run-report.json
→ 自动生成单文件 replay.html
→ 第 1～40 天事实回放
```

核心 `GameEnvironment` 是当前 Direct 竞技的唯一事实核心。四个 Episode 相互隔离，公共市场共享 seed，个人随机按槽位隔离。Replay 使用 `arena-schema-v2`，包含 `competitionAudit`、每个 Agent 的 Provider/model/adapter/persona、技术失败分类和退出日，以及 Day 40 才揭示的 `luckAudit`。

## Scripted 金样

Scripted 只用于显式、确定性的离线金样：

```bash
npm run arena:sample
npm run build:arena
```

它不会静默进入正式页面，也不能作为真实模型验收证据。正式前端没有 `sampleReplay` fallback；缺少或无法验证 Replay 时直接报错并停止展示。

## 观众页事实范围

观众页保留：

- Provider、模型和 adapter version；
- 当日每位 Agent 的完整动作序列与执行结果；
- 现金、存款、债务、健康、库存与净资产；
- 公共参考价格与公共事件；
- Day 1～39 按公开参考价计算的暂定排名及变化；
- 技术 DNF 类别和退出日；
- Day 40 直接来自核心 `finalRanking` 的正式排名；
- 个人随机事件计数、最幸运/最倒霉并列结果和 Replay hash。

Day 1～39 的可见状态和导出不包含终局与运气数据。页面载入后会移除原始注入节点，避免尚未揭示的原始 Replay 继续留在 DOM。浏览器只回放事实，不会调用模型。

采访、预测对账、发言舞台、导演高光、奖项、人物结局和模型生成解说已从当前 Replay 契约、适配类型和正式页面删除。

## 离线与确定性构建

从任何有效 Replay 显式重建：

```bash
npm run arena:replay -- --input /absolute/path/to/replay.json
```

构建流程会：

1. 校验 schema、四 Agent、40 天和 canonical `replayHash`；
2. 在移除 Provider Key 的环境中构建 Web；
3. 按固定顺序内联脚本、样式与本地资源；
4. 内嵌 Replay，不添加时间戳；
5. 拒绝远程 `src`/`href`、外链脚本/样式、`fetch`、XHR、WebSocket、EventSource 与远程 CSS URL；
6. 检查 Replay hash 与 fact hash 已进入 HTML。

完整 Direct 比赛先写 `replay.json`、Trace 和报告，再调用同一构建入口。HTML 构建失败不会删除比赛产物，也不会要求重新调用模型。

## 测试与本地验收

```bash
npm run test:arena
npm --prefix web run typecheck
npm run build:arena
```

离线测试覆盖：中性 Prompt/策略 hash、无身份模型观察、三类 Provider 协议、usage 与错误脱敏、Probe 四请求守卫、单 Provider DNF 隔离、报告聚合、Replay hash/排名/运气、正式前端失败关闭和 Day 1/39/40 可见性。

`npm run build:arena` 还会生成显式 Scripted 金样并检查离线 HTML。离线验证本身不代表四个真实 Provider 在线可用；仓库已在 2026-08-21 完成一次有明确配置边界的真实验收，详见 [真实验收记录](arena-direct-acceptance-2026-08-21.md)。未来任何凭据、模型 ID、网关或预算变化仍必须先执行 `--probe-providers`，再单独授权 `--confirm-live-run`。

## MCP 状态

仓库原 MCP Server 保持 legacy 状态，不迁移到新核心、不扩建，也不写入当前完成声明。`StrictMcpEpisodePort` 仅保留一个很小的接口占位；Match Runner 的守卫测试会拒绝把 MCP driver 当成已执行能力。

## 不包含的操作

当前实现不包含 commit、push、部署、发布或公网托管。`dist/` 是可重复生成且被 Git 忽略的本地产物目录。
