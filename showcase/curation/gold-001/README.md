# Gold1 人工精选高光

此目录保存 Gold1 的展示层白名单，不修改冻结 Replay，也不改变事实层哈希。

最终展示仅包含以下五条：

| 编号 | 天数 | 标题 |
|---|---:|---|
| G1-04 | 21 | Qwen 逆袭登顶 |
| G1-08 | 24 | 获赠假酒，现场变现还债 |
| G1-14 | 32 | 梭哈假白酒，反超登顶 |
| G1-18 | 36 | Claude 遗憾退场 |
| G1-20 | 40 | 终局揭晓 |

`replay-enrichment.json` 由 `generateCuratedReplayEnrichment` 生成，并同时绑定 Gold1 的 `matchId`、Replay hash 与事实层 hash。任何标题、摘要、证据或顺序变更都会使白名单校验失败。

Gold2 目前冻结，不在此目录维护。
