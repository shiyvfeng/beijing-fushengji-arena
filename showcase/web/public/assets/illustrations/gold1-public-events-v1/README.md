# Gold1 公共事件素材 v1

本目录保存依据 Gold1 冻结 Replay 中**实际发生过**的公共事件生成并接入 Replay UI 的插画。

- 生成工具：Codex built-in ImageGen
- 生成日期：2026-08-23
- 统一画风参考：`../arena-stage-zhongguancun-2000s-v1.png`
- 生成母版：1536 × 1024，RGB PNG，3:2 横向
- 运行时副本：768 × 512，RGB PNG，3:2 横向；manifest 只接入这些 `-runtime.png` 文件
- Seed：内置工具未返回
- 手工处理：母版仅复制并重命名；运行时副本等比缩小到 768 × 512
- 使用边界：私人概念演示；公开或商业传播前需复核生成式素材条款、项目许可证及画面细节

## 事实映射

| Catalog 事件 | Gold1 实际发生日 | 冻结 Replay 中的公共事件 | 素材文件 |
|---|---|---|---|
| `market-01` | Day 14 | 专家提议提高大学生“动手素质”，进口玩具颇受欢迎 | `gold1-public-event-market-01-v1-runtime.png` |
| `market-04` | Day 21 | 文盲轻视文学奖，转而追捧盗版 VCD 港台片 | `gold1-public-event-market-04-v1-runtime.png` |
| `market-05` | Day 8、19 | 小报社论推动走私汽车消费 | `gold1-public-event-market-05-v1-runtime.png` |
| `market-06` | Day 10、18、33 | 社论推动伪劣化妆品热销 | `gold1-public-event-market-06-v1-runtime.png` |
| `market-07` | Day 2、7、10 | 电子书店拒售后，禁书黑市价格走高 | `gold1-public-event-market-07-v1-runtime.png` |
| `market-08` | Day 18、32、38 | 晚会人物宣称使用伪劣化妆品，引发抢购 | `gold1-public-event-market-08-v1-runtime.png` |
| `market-09` | Day 21、32 | 假白酒因狂饮新闻卖出高价 | `gold1-public-event-market-09-v1-runtime.png` |
| `market-10` | Day 28 | 大学生求职，水货手机走俏 | `gold1-public-event-market-10-v1-runtime.png` |
| `market-12` | Day 20、24 | 市场涌入走私香烟 | `gold1-public-event-market-12-v1-runtime.png` |
| `market-13` | Day 2、12、28 | 孩子忙于上网学习，进口玩具无人问津 | `gold1-public-event-market-13-v1-runtime.png` |
| `market-14` | Day 6、19、20、31、32、37 | 中关村盗版 VCD 交易兴旺 | `gold1-public-event-market-14-v1-runtime.png` |

事实来源：`samples/gold-001/replay.json` 中各日 action result 的 `scope: "public"` effect。画面是对事件叙事的展示层可视化，不改变 Replay 事实层或哈希。

## 接入状态

当前状态为 **已接入**：

- `web/public/assets/asset-manifest.json` 注册 11 个 `event.gold1.market-*` 素材 ID
- Replay Adapter 保留公共 effect 的 `catalogEventId`
- `web/src/public-event-assets.ts` 按 `catalogEventId` 做确定性映射
- 未知或旧格式事件继续使用检查/市场波动回退图
- 冻结 Replay 与 Gold1 Enrichment 均未修改

完整提示词见 [`PROMPTS.md`](./PROMPTS.md)。
