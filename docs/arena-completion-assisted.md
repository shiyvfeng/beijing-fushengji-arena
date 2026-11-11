# Completion-Assisted v1 Runner

`completion-assisted-v1` 是五模型 Direct Runner 的独立完成辅助轨道。它不替代 Strict Direct，也不复用 Strict 的 Probe、Stability、Match 指纹或三场样本计数。

## 运行语义

- 必须显式传入 `--completion-assisted`；未传入时仍运行 Strict Direct。
- 每个自主游戏日通常只发起一次模型请求。模型只能从 Runner 预验证的 `planId` 与 `destinationId` 动态枚举中选择：

  ```json
  {"planId":"P001","destinationId":7}
  ```

- 一个日计划最多包含两项当前地点内操作，随后移动到另一地点并推进一天。Runner 在提交前重新模拟整日事务；预验证与提交不一致时按 Runner/integrity 缺陷失败关闭。
- Provider、网络或模型输出故障最多共用三次请求机会。瞬态故障按 15 秒、45 秒退避；连续三个瞬态辅助日后依次跳过 2、4、8 日并半开探测。
- 每个 Agent 的 Provider 请求与退避总预算默认 45 分钟。预算耗尽或达到恢复边界后，Runner 使用显式 `assisted_pass_day` 推进，不伪装成模型动作。
- 辅助过日保持地点与地图不变，但照常结算银行与债务利息、公共市场和公共事件、个人事件、健康、死亡以及 Day 40。
- Provider 故障不产生技术 DNF；进程退出、磁盘故障及 Runner/integrity 缺陷不在完成保证内。

## 候选计划

Runner 为当前状态确定性生成候选，始终包含空操作及全部可行单操作；可行双操作经模拟、最终状态去重和稳定轮转后补充，总数不超过 128。数量候选使用：

- 买卖、治疗：`1 / 可行上限的一半 / 可行上限`。
- 存款、取款、还债：`25% / 50% / 100%` 可行金额。
- 扩容：满足条件时唯一候选。

`assisted_pass_day` 永不出现在模型候选中。已有地点时目的地为其余 19 个地点；尚无地点时为全部 20 个地点。

## 离线检查与付费门禁

以下命令必须使用同一个输出目录和完全相同的运行参数。每一步都需要显式带上 `--completion-assisted`：

```bash
npm run arena:direct -- --completion-assisted --check-config \
  --output-dir dist/arena-completion-assisted/run-001 \
  --match-id arena-completion-assisted-v1-run-001

npm run arena:direct -- --completion-assisted --probe-providers \
  --output-dir dist/arena-completion-assisted/run-001 \
  --match-id arena-completion-assisted-v1-run-001

npm run arena:direct -- --completion-assisted --stability-probe \
  --output-dir dist/arena-completion-assisted/run-001 \
  --match-id arena-completion-assisted-v1-run-001

npm run arena:direct -- --completion-assisted --confirm-live-run \
  --output-dir dist/arena-completion-assisted/run-001 \
  --match-id arena-completion-assisted-v1-run-001
```

`--check-config` 不联网且不写比赛产物。Probe 仍对五个 Provider 并行各请求一次，五项必须全部返回有效日计划。Stability 要求每个模型连续自主推进 10 个游戏日；允许被审计的重试，但任何辅助日都会使门禁失败。正式比赛仍需单独授权。

## 产物与兼容性

- Replay 继续使用 `arena-schema-v4`、`executionMode: "direct"` 和既有顶层结构。
- 新轨通过 `competitionAudit.runTrack: "completion-assisted-v1"`、可选 `assistance` 事件及 `reliabilityAudit` 增量扩展。
- 模型调用账本为 v3，使用 `actionEventIds[]` 关联一个日计划产生的多条动作事件；辅助事件另用 `assistanceEventId`。
- Run Report 为 v6，输出自主推进日占比、首次请求成功率、有效计划选择率、Provider 请求成功率、累计等待、重试、辅助原因、熔断跳过日及预算耗尽日。
- 可靠性指标不改变净资产或游戏排名，也不得与 Strict Direct 样本混排。
- Replay UI 的兼容实现保留在独立 `replay-ui` worktree；旧 Strict Replay 的读取和展示行为保持不变。

## 安全边界

- API Key 仅从本机环境或 env 文件读取；不要写入文档、聊天或产物。
- `ARENA_SAVE_RAW_EXCHANGES` 默认关闭。开启时仅用于受控诊断，正式验收仍需执行敏感信息扫描。
- 本轨继续使用各 Provider 已配置的最低非关闭思考等级。
