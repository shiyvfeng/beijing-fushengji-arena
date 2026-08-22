# Arena Design QA

> 当前状态：五模型事实页面已随待办 1 实现并通过单元测试，待办 2 的可重复自动浏览器验收尚未执行，因此新版 P0 仍未验收。本文原有的笼统“通过”结论只对应旧 development fallback/四模型演示实现，已转为历史证据。

## 历史参考与证据

- 当前宏观视觉基准：`design/imagegen-shared-interview-stage-2026-08-20/04-dark-actions-and-event.png`；它是四位角色的历史概念图，不是五模型事实页面截图。
- 历史探索参考：`03-dark-prices-and-ticker.png`。
- 历史 1920×1080 development fallback 截图：[`qa-day33-1920x1080-final.png`](./qa-day33-1920x1080-final.png)。
- 历史 1366×768 development fallback 截图：[`qa-day40-1366x768.png`](./qa-day40-1366x768.png)。
- 历史局部对照：[`qa-compare-source-implementation.png`](./qa-compare-source-implementation.png)。

这些截图中的采访、预测、逐项终局、四个密封项、A/B/C/D 和模拟数据不属于当前 P0 事实页面，也不能证明正式 Replay 通过。2026-08-21 四槽 `run-001` 的真实 Day 1/39/40、离线与浏览器结果另见 [`docs/arena-direct-acceptance-2026-08-21.md`](../docs/arena-direct-acceptance-2026-08-21.md)，该记录同样不满足新版五模型 P0。

## 新版 P0 验收对象

待办 2 验收必须使用新版五模型 Direct 真实 Replay，而不是 Scripted、sample、development fallback、Fake Provider 或 `run-001`。页面需要满足：

- 同场五个不可重复的 `Provider + Model` 组合；可见身份只显示 `Provider + Model`，不显示 A/B/C/D、策略化名称或 persona；
- Day 1～39 只显示当日可知事实、暂定排名和排名变化；Day 40 正式排名逐项等于核心 `finalRanking`；
- 五个 Agent 的完整当日动作序列、现金、存款、债务、健康、库存、净资产、公共价格和公共事件均可查看；
- 技术 DNF 保持占位，显示错误分类与退出日，不获得正式名次；
- P0 Runner 只提供随机事件原始计数，不在事实页内生成“最幸运/最倒霉”；P0.5 生成标签时技术 DNF 不参与候选；
- Replay hash 可见且完整，缺失、无效或不匹配时页面失败关闭；
- 没有模拟动作、采访、排名、奖项、结局或其他 fallback。

## 版式与交互检查

- 在 1920×1080 和 1366×768 下检查五模型信息密度，页面不得出现文档级水平溢出，关键数字无需缩放即可辨认。
- 日期滑杆、前后日、直接输入日期和所有详情区域使用同一个日期游标。
- 覆盖 Day 1、Day 39、Day 40、至少一个正常 Agent 详情、一个游戏内失败和一个技术 DNF。
- 键盘可操作，焦点进入/退出弹窗正确，Escape 可关闭；语义、ARIA 和可见文本不得泄露未来事实。
- 不以颜色作为唯一状态信号；五个 Provider/model 使用稳定且可区分的视觉编码。
- `prefers-reduced-motion` 下关闭非必要动画。

## 离线、控制台与自动化

- 同一 `replay.html` 必须通过 `file://` 断网打开，并确认没有 `fetch`、XHR、WebSocket、EventSource、外链脚本、外链样式或模型调用。
- 可临时通过仅绑定 `127.0.0.1` 的本地静态服务执行 DOM、控制台和交互自动化，但 localhost 不能替代 `file://` 验收。
- 自动浏览器验收是 P0 硬要求，工具品牌不强制；可使用 Playwright、内置浏览器、Chrome 控制或其他等价工具，但命令、输入 Replay、视口、断言和结果必须可重复。
- 控制台应为 0 error、0 warning；浏览器自动请求 `/favicon.ico` 的已解释 404 可单独记录。
- 同一 Replay、源码和锁文件重复构建的 HTML SHA-256 应一致。

## P0.5 Replay Enrichment 验收边界

导演高光、采访、奖项等不纳入 P0 通过条件。进入 P0.5 后另行验收：

- 通用 Enrichment 使用与五个 Runner `Provider + Model` 组合均不重复的第六模型配置；
- Enrichment 失败不影响事实页打开、事实 hash、排名或 Runner 产物；
- 赛后采访调用参赛者原模型时，每个历史采访截面只能读取该选手截至采访日已发生的事实结果；
- 派生叙事、采访和历史轮次结论不进入 Runner 或后续比赛上下文；
- 页面明确区分事实与派生内容，并保留派生版本、来源和 hash。

## 通过条件

只有当至少 3 场新版五模型 Direct 比赛均产出有效事实页面，并完成上述可重复自动浏览器验收后，才可以把本文件状态改为“通过”。游戏内死亡、破产或解释充分的技术 DNF 可以是有效比赛结果；未解释中断、四模型产物或模拟 fallback 不能作为通过。
