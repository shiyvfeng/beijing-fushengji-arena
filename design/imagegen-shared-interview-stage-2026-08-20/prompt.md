# 生成提示词

```text
Use case: ui-mockup
Asset type: high-fidelity 16:9 desktop web homepage concept for 北京浮生记 Arena
Primary request: Generate a new homepage mockup that preserves Image 1's macro layout and proportions, but replaces its entire middle content area with one shared four-AI interview stage. The four AI characters must stand together in the same continuous scene, never inside four separate cards or four framed boxes. Use Image 2 only as a visual-style reference for restrained early-2000s pixel art and Beijing street-market atmosphere.
Input images: Image 1 is the layout reference; Image 2 is the style reference only. Do not copy Image 2's characters, lobster mascots, product name, logos, signs, or text.
Scene/backdrop: a single shallow pixel-art stage resembling a Beijing electronics market or subway-side street market around 2000, with simple low-detail storefront silhouettes and a muted blue-gray city backdrop. It should read as one static background illustration that could be delivered as one local image.
Subject: four original, clearly different AI mascots standing shoulder-to-shoulder as one group in the central stage. Agent A is a practical CRT-monitor-headed robot in blue-gray; Agent B is a bold cassette-player-headed robot in orange-red; Agent C is a calm calculator-headed robot in teal; Agent D is a lively radio-headed robot in mustard-purple. Keep silhouettes compact and simple enough to later recreate as four static transparent PNGs. Each character has a small colored A/B/C/D identity tag.
Central interview interaction: above the shared stage, include two compact mode tabs labeled exactly “比赛宣言” and “采访回放 · 第30天”, with interview replay active. Show pixel-bordered speech bubbles connected to the characters; one selected character has a larger highlighted interview bubble reading exactly “风险还没解除，我会保留现金。” while the other three have short visible bubbles reading exactly “先还债。”, “我信数据。”, and “活到第40天。”. Speech bubbles must look like ordinary HTML/CSS overlays, not baked cinematic effects. Include a small “上一段 / 下一段” interview control.
Macro layout to preserve from Image 1: dark top header with product title, replay mode, worldline, day count and utility buttons; left 40-day key-event timeline and simple playback controls; right current ranking/status list for four Agents; bottom shared day scrubber and four-line net-worth chart; bottom-right awards preview. Keep the center as the largest visual area.
Style/medium: shippable product UI mockup mixed with clean 2D pixel-art illustration; 16-bit/32-bit-era pixel texture, crisp hard edges, low-resolution sprite feel, limited colors; the interface itself uses practical rectangular CSS panels, borders, tabs and charts.
Composition/framing: full-bleed 16:9 desktop screen, straight-on orthographic view, no monitor or browser frame; projection-readable; clear hierarchy; center characters fully visible from head to feet or knees and not covered by interface panels.
Lighting/mood: evening indoor market light, playful competitive broadcast, warm and lively but not neon cyberpunk.
Color palette: charcoal UI shell, muted navy and slate blue, cream text, warm amber, brick red, teal green and mustard yellow; controlled glow only on selected states.
Text (verbatim): “北京浮生记：AI发财生存赛”, “比赛回放”, “世界线：VCD 黄金周”, “第 33 / 40 天”, “关键时间线”, “代理人实时状态”, “比赛宣言”, “采访回放 · 第30天”, “上一段”, “下一段”, “净资产趋势”, “荣誉预览”.
Phase-1 feasibility constraints: everything outside the center art must look achievable with CSS Grid, standard HTML controls and a normal line-chart library; center art can be one static backdrop plus four static transparent character PNGs; bubbles, labels and selection states are HTML/CSS overlays; no sprite-sheet animation, lip sync, parallax, particles, 3D, video, complex masking or custom icon set required. No future spoilers beyond the displayed day.
Content constraints: use only fictional game data and game commodities such as VCD, 水货手机, 进口香烟 and 走私汽车; no stock exchange data, no real company names, no vendor brands.
Avoid: four separate character cards in the center, portrait-circle avatars as the main center content, photorealism, anime rendering, glossy 3D, glassmorphism, dense enterprise dashboard, tiny text, copied OpenClaw branding, copied lobster characters, real people, trademarks, watermark.
```

## 输入图角色

- Image 1：布局参考，不是编辑目标。
- Image 2：画风参考，不是编辑目标。

## 执行方式

- Codex 内置 `imagegen`
- 两张本地参考图均通过 `referenced_image_paths` 提供
- 未使用 CLI、API Key 或外部网络素材
