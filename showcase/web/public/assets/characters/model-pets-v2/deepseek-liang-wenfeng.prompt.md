# DeepSeek / 梁文锋像素立绘提示词 v2

```text
Use case: identity-preserve
Asset type: full-body transparent pixel-art game character sprite
Input images: Image 1 is the v1 project character and pixel-art style reference; Image 2 is the user-provided identity, face, hair, glasses, blue-suit wardrobe and speaking-gesture reference
Primary request: Create one recognizable mature full-body pixel-art character inspired by Liang Wenfeng. Preserve a slim youthful East Asian adult face, short slightly side-parted black hair, thin rectangular glasses and a natural speaking expression. Dress him in a cobalt-blue suit jacket, pale-blue open-collar shirt without a tie, dark trousers and black dress shoes. Raise the right hand near the chest in a precise explanatory speaking gesture while the left arm hangs naturally.
Style/medium: keep the v1 set's polished 2D pixel-art language and dark stepped outline while replacing the former oversized-head chibi proportions with a mature slim silhouette
Composition/framing: about 4.5–5 heads tall; complete hair, hands, legs and shoes visible; centered with safe margins
Scene/backdrop: genuine transparent alpha; no scenery, podium, microphone or floor
Constraints: one complete character; preserve glasses, cobalt-blue suit and speaking gesture; no crop, text, logo, watermark, prop, extra character, shadow, glow, halo or checkerboard
Avoid: chibi oversized head, baby face, large anime eyes, casual hoodie, sneakers, necktie, podium or microphone
```

内置输出为 1254 × 1254 RGB，并把灰白棋盘烘焙进背景。最终仅对通过内容验收的版本做确定性背景 Alpha 提取，再以最近邻规范为 1024 × 1024 RGBA；人物内容没有手工重绘。
