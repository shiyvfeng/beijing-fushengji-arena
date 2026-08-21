# 深色物价与滚动字幕版本生成提示词

```text
Use case: ui-mockup
Asset type: revised high-fidelity 16:9 desktop web homepage concept for 北京浮生记 Arena
Intent: edit Image 1. Image 1 is the strict content/layout target; Image 2 is the dark-theme and central-illustration mood reference.
Primary request: restore a polished dark theme while preserving Image 1's overall page structure, four-AI shared interview stage, right status list, playback controls, bottom day scrubber, four-line net-worth chart and awards preview. Make exactly one information-architecture change: remove the large “关键时间线（40天）” list from the upper-left panel, replace that freed panel with today's commodity prices, and move the already-revealed key-timeline items into a single horizontal scrolling subtitle strip directly underneath the central live/interview stage.
Input images: Image 1 is the edit target. Preserve its semi-realistic four-robot illustration, shared-stage concept and proportions. Image 2 is a dark UI and cinematic illustration reference only; do not copy its people, signs, exact content or logos.
Whole-page dark theme: deep charcoal and warm black panels, restrained navy-gray surfaces, thin slate borders, cream/off-white text, amber selected states, brick-red alerts, accessible green/red price changes, subtle warm edge glow. Match Image 2's elegant dark broadcast-dashboard atmosphere. Do not revert the center to pixel art.
Upper-left replacement panel: title it exactly “今日物价 · 第33天” with a small subtitle “公共参考价”. Use a compact, readable market-board table with columns “商品”, “现价”, “涨跌”. Show all eight game commodities as rows, using these exact names: “进口香烟”, “走私汽车”, “盗版VCD”, “假白酒”, “禁书”, “进口玩具”, “水货手机”, “伪劣化妆品”. Use plausible fictional yuan prices and mixed red/green up/down arrows. Highlight “水货手机” as today's strongest increase. This panel replaces the timeline entirely; no vertical day timeline or timeline event cards may remain in the left column. Keep the existing “回放控制” panel below it.
Central shared live/interview stage invariants: retain four original semi-realistic illustrated AI robots standing shoulder-to-shoulder in one continuous Beijing electronics-market scene, labeled A/B/C/D and never inside four separate cards. Retain the two tabs “比赛宣言” and “采访回放 · 第30天”, the four connected speech bubbles, one highlighted interview bubble, and “上一段 / 下一段” controls. Keep the same semi-realistic cinematic editorial-game illustration style as Image 1, with darker evening market lighting compatible with the dark UI.
New rolling subtitle strip: add one thin full-width ticker immediately below the central live/interview illustration and immediately above the existing day scrubber/chart area. Label the left edge exactly “关键时间线”. Show a single-line horizontally scrolling sequence of already-revealed events separated by diamonds: “第05天 第一桶金 ◆ 第12天 突击检查 ◆ 第18天 健康危急 ◆ 第25天 债务清零 ◆ 第33天 水货手机价格翻倍”. Highlight the current Day 33 item in amber/red. The ticker should look like an ordinary CSS overflow marquee or translated text row, not a second large panel and not multiple stacked event cards.
Text (verbatim): “北京浮生记：AI发财生存赛”, “比赛回放”, “世界线：VCD 黄金周”, “第 33 / 40 天”, “今日物价 · 第33天”, “公共参考价”, “商品”, “现价”, “涨跌”, “代理人实时状态”, “比赛宣言”, “采访回放 · 第30天”, “上一段”, “下一段”, “关键时间线”, “净资产趋势”, “荣誉预览”.
Phase-1 feasibility constraints: standard CSS Grid/Flex panels, a normal HTML table/list for commodity prices, one CSS overflow ticker for subtitles, ordinary buttons/tabs, and a standard line-chart library. Central art is one static illustration with four static characters; speech bubbles remain HTML/CSS overlays. No animation dependency beyond an optional simple ticker transform; no lip sync, sprite animation, parallax, particles, 3D, video or complex masks.
Information constraints: show no future event beyond Day 33. Commodity prices are fictional visual placeholders, not stock-market data. No real companies or vendor brands.
Preserve: 16:9 full-screen framing; top header; left-column width; central-stage size as much as possible; four-person grouping; speech-bubble interaction; right ranking/status list; bottom controls, chart and awards.
Avoid: any remaining vertical key-timeline list in the left panel, duplicate timeline content, light-theme page sections, four separate central character cards, pixel-art rendering, stock exchange information, tiny text, anime, glossy 3D, glassmorphism, copied signage, real people, trademarks, watermark.
```

## 输入图角色

- Image 1：上一轮 `02-light-shared-ai-interview-stage.png`，编辑目标和结构参考。
- Image 2：`../ChatGPT Image 2026年8月20日 01_00_53.png`，深色主题与中央插画氛围参考。

## 执行方式

- Codex 内置 `imagegen`
- 两张本地参考图通过 `referenced_image_paths` 提供
- 未使用 CLI、API Key 或外部网络素材
