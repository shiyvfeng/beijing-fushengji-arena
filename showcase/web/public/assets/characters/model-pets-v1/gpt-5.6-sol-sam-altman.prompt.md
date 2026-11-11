# GPT-5.6-sol / Sam Altman 像素桌宠提示词

## 最终生成规格

```text
Use case: stylized-concept
Asset type: single-frame Codex desktop pet character master
Input image: DeepSeek / Liang Wenfeng asset is a style reference only. Match its crisp clustered pixel density, dark outline weight, compact chibi scale and desktop-pet readability. Do not copy its identity, face, glasses, hair, clothing or blue palette.
Primary request: Create exactly one friendly, recognizable but simplified chibi pixel-art full-body humanoid inspired by Sam Altman for GPT-5.6-sol. This is an unofficial concept character, not a photorealistic portrait.
Scene/backdrop: genuinely transparent background with preserved alpha; no scenery and no floor
Subject: short brown hair, calm friendly expression, graphite casual jacket and trousers, off-white shirt and shoes, restrained green accents, front-facing with a subtle three-quarter turn, natural idle pose
Style/medium: polished 2D pixel-art Codex desktop pet, crisp deliberately clustered pixels, consistent dark outline, compact oversized head and short body, readable at 192x208
Composition/framing: square 1024x1024 master, centered complete full body and feet, subject occupies about 75 percent of the canvas with even safe margins
Lighting/mood: restrained soft upper-left pixel lighting, approachable and composed
Text: none
Constraints: exactly one complete connected character; actual transparent alpha; no crop, logo, brand mark, text, watermark, prop, scenery, ground shadow, glow, aura, detached effect, checkerboard or border
Avoid: photorealism, anime, 3D render, formal suit and tie, extra people, copied DeepSeek identity or blue clothing
```

生成器的透明修正仍留下假棋盘背景，因此最终交付只对与画布边缘连通的浅色背景执行了确定性 Alpha 提取，没有重绘人物。
