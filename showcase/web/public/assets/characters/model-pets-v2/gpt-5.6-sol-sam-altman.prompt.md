# GPT-5.6-sol / Sam Altman 像素立绘提示词 v2

```text
Use case: identity-preserve
Asset type: full-body transparent pixel-art game character sprite
Input images: Image 1 is the v1 project character and pixel-art style reference; Image 2 is the user-provided identity, face, hair, wardrobe and crossed-arm pose reference
Primary request: Create one recognizable mature-adult pixel-art full-body character inspired by Sam Altman. Preserve a narrow adult face, curly gray-brown short hair, blue-green eyes, clean-shaven calm expression, deep navy tailored suit, pale-blue open-collar shirt without a tie, dark trousers and dark dress shoes. Use his iconic both-arms-crossed pose.
Style/medium: match the v1 set's polished 2D pixel-art language with medium-density 16/32-bit clusters, simplified shading and a bold dark stepped outline; keep the pixel style while removing the former oversized-head chibi look
Composition/framing: about 4.5–5 heads tall; complete hair, hands, legs and shoes visible; centered; subject occupies about 80 percent of the square canvas height with safe margins
Scene/backdrop: genuine transparent alpha; no scenery or floor
Constraints: one complete character; preserve recognizable identity, formal clothing and crossed-arm pose; no crop, text, logo, watermark, prop, extra character, shadow, glow, halo, checkerboard or grid
Avoid: photorealism, smooth vector rendering, 7–8-head fashion illustration, oversized chibi head, casual jacket, sneakers, tie
```

内置输出为 1254 × 1254 RGB，并把灰白棋盘烘焙进背景。最终仅从画布边缘遍历中性高亮背景并设为透明，再以最近邻把主体规范为约 820 px 高并居中到 1024 × 1024 RGBA；人物内容没有手工重绘。
