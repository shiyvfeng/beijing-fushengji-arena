# 深色今日动作与突发事件版本生成提示词

```text
Use case: ui-mockup
Asset type: revised high-fidelity 16:9 desktop web homepage concept for 北京浮生记 Arena
Intent: edit Image 1 with two tightly scoped panel replacements. Image 2 is a content/layout reference for “今日动作”. Image 3 is a content reference for “突发事件”, but its complex per-Agent comparison table must NOT be copied.
Primary request: preserve Image 1's dark theme, top header, left “今日物价” panel, central four-AI interview stage, rolling key-timeline ticker, right live ranking/status list, bottom day scrubber, net-worth chart, proportions and visual style. Replace only these two panels:
1. Replace the lower-left “回放控制” panel with a simplified breaking-event card.
2. Replace the lower-right “荣誉预览” panel with a compact four-row “今日动作” list.
Do not redesign or move any other region.
Lower-left breaking-event card: title exactly “突发事件：中关村突击检查” with a small time label “09:30 发生”. Use a simple vertical composition suited to the existing narrow lower-left panel: red/brick-red title strip; one single cinematic semi-realistic illustrated event image showing generic market inspectors checking a table of pirated VCD discs in an early-2000s Beijing electronics market; then one short readable paragraph below the image. The paragraph should read exactly: “市场突击检查，部分盗版VCD被没收。Agent A 罚款 ¥800，Agent C 罚款 ¥1,500；其余两人未受影响。” No table, no four Agent columns, no impact matrix, no repeated avatar rows, no charts, no buttons. It must be just one event image plus concise text description.
Lower-right today-actions panel: title exactly “今日动作（最新一条）”. Adapt Image 2's simple four-row structure to Image 1's dark visual system. Show four compact rows with a colored A/B/C/D identity marker, time, latest action, immediate result/cost, and a right-aligned location chip:
A | 09:20 | 买入盗版VCD（200张） | 花费 ¥2,600 | 中关村
B | 09:10 | 前往西单 | 路费 ¥200 | 西单
C | 09:05 | 还债 2,000 元 | 剩余债务 ¥8,000 | 三里屯
D | 08:55 | 住院治疗 | 花费 ¥1,200 | 火车站
Use four clear horizontal rows, subtle separators, fixed Agent colors, dark panel background, cream text, muted secondary text, and restrained colored location chips. Keep it readable at projection size and less decorative than the removed awards cards.
Preserve exactly: “北京浮生记：AI发财生存赛”, “比赛回放”, “世界线：VCD 黄金周”, “第 33 / 40 天”, the top navigation, “今日物价 · 第33天”, all eight commodity rows, the four robots and their speech bubbles, “比赛宣言”, “采访回放 · 第30天”, “上一段”, “下一段”, the single-line “关键时间线” ticker, “代理人实时状态”, the day scrubber and “净资产趋势”.
Dark visual system: deep charcoal/warm-black panels, restrained navy-gray surfaces, thin slate borders, cream text, amber selected states, brick-red incident accents, accessible green/red values. Event illustration should match the central scene's cinematic semi-realistic editorial game art, not pixel art.
Phase-1 feasibility: lower-left event uses one static image and ordinary text; lower-right actions use a normal four-row HTML list/table. No custom animation, complex comparison visualization, 3D, video, masks or interaction dependency.
Information constraints: all content is fictional game data; no real company names or brands; no future information beyond Day 33.
Avoid: keeping any playback-speed controls in the lower-left; keeping any honor/award cards in the lower-right; copying Image 3's four-column impact table; adding extra panels; changing the center composition; light-theme surfaces; pixel-art rendering; stock data; tiny text; anime; glossy 3D; glassmorphism; real people; trademarks; watermark.
```

## 输入图角色

- Image 1：`03-dark-prices-and-ticker.png`，编辑目标。
- Image 2：用户提供的“今日动作”截图，只参考四行信息结构。
- Image 3：用户提供的“突发事件”截图，只参考事件主题与插画内容，不复制四栏表格。

## 执行方式

- Codex 内置 `imagegen`
- 三张本地图片通过 `referenced_image_paths` 提供
- 未使用 CLI、API Key 或外部网络素材
