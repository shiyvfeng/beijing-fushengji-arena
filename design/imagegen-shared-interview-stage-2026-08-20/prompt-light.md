# 浅色系版本生成提示词

```text
Use case: ui-mockup
Asset type: revised high-fidelity 16:9 desktop web homepage concept for 北京浮生记 Arena
Intent: edit Image 1 while preserving its layout and interaction concept. Image 2 is only a style reference for the central illustration.
Input images: Image 1 is the edit target and strict layout/content reference. Image 2 is the central-illustration style reference; study only the cinematic, semi-realistic narrative painting in its middle event area. Do not copy its UI colors, layout, text, people, logos, signage, or exact scene.
Primary request: keep Image 1's page layout unchanged, including every major region, proportion, alignment and interaction: top competition header; left 40-day key-event timeline and playback controls; center shared four-AI interview stage with “比赛宣言 / 采访回放”; right four-Agent live ranking/status list; bottom day scrubber and four-line net-worth chart; bottom-right awards preview. Keep the four AI characters together in one continuous central scene, never inside four separate cards. Change the entire page to a genuinely light theme, and change only the central illustration style from pixel art to the cinematic semi-realistic editorial game illustration seen in Image 2's middle picture.
Whole-page light theme: warm off-white page canvas, ivory and very pale blue-gray panels, white cards, thin cool-gray borders, soft restrained shadows, dark navy body text, muted brick-red and mustard selected states, accessible green/red data accents. The header, left sidebar, right sidebar, chart, controls and awards area must all be light; no large black, charcoal or near-black panels anywhere.
Central scene/backdrop: bright overcast daytime or softly lit late-afternoon Beijing electronics market around 2000, rendered as a cinematic semi-realistic 2D digital painting with textured brushwork, believable street depth, slightly desaturated colors, period storefront shapes, VCD and mobile-phone market atmosphere. Keep it visually light enough to sit inside the light UI. Avoid readable real-world brand signs.
Central subjects: the same four original AI mascots from Image 1, still shoulder-to-shoulder in a single group and still labeled A/B/C/D, but reinterpret them as tasteful semi-realistic illustrated robot characters rather than pixel sprites: A is a practical CRT-monitor-headed robot in blue-gray, B is a bold cassette-player-headed robot in brick orange, C is a calm calculator-headed robot in teal, D is a lively radio-headed robot in mustard-purple. Use clean readable silhouettes, moderate detail, no photoreal humans, no anime.
Central interview interaction invariants: keep two tabs labeled exactly “比赛宣言” and “采访回放 · 第30天”, with interview replay active. Keep visible speech bubbles connected to the four characters. One selected character has a larger highlighted bubble reading exactly “风险还没解除，我会保留现金。”; the other three bubbles read exactly “先还债。”, “我信数据。”, and “活到第40天。”. Keep the simple “上一段 / 下一段” controls. Bubbles must look like HTML/CSS overlays: white or pale-cream fill, thin navy/amber border, simple triangular tail, no cinematic special effects.
Text (verbatim): “北京浮生记：AI发财生存赛”, “比赛回放”, “世界线：VCD 黄金周”, “第 33 / 40 天”, “关键时间线”, “代理人实时状态”, “比赛宣言”, “采访回放 · 第30天”, “上一段”, “下一段”, “净资产趋势”, “荣誉预览”.
Phase-1 feasibility constraints: the UI must still look reproducible with CSS Grid, ordinary cards/buttons/tabs and a standard line-chart library. The central art may be one static light-background illustration with four static characters; bubbles, labels and selection states remain HTML/CSS overlays. No animation, lip sync, particles, parallax, 3D, video, complex masks or custom icon dependency.
Content constraints: use fictional game data and only game commodities such as VCD, 水货手机, 进口香烟 and 走私汽车; no stock exchange data, real company names or vendor brands.
Preserve: 16:9 full-screen framing, macro layout, center-stage size, four-person grouping, speech-bubble interaction, timelines, chart, ranking list and awards area.
Avoid: any dark-theme page section, four separate center character cards, pixel-art rendering, photorealism, anime, glossy 3D, glassmorphism, tiny text, copied signage, real people, trademarks, watermark.
```

## 输入图角色

- Image 1：上一轮 `01-shared-ai-interview-stage.png`，编辑目标和严格布局参考。
- Image 2：`../ChatGPT Image 2026年8月20日 01_00_53.png`，只参考中央事件画面的插画质感。

## 执行方式

- Codex 内置 `imagegen`
- 两张本地参考图通过 `referenced_image_paths` 提供
- 未使用 CLI、API Key 或外部网络素材
