# Qwen 水豚像素立绘提示词 v2

```text
Use case: identity-preserve
Asset type: full-body transparent pixel-art game mascot sprite
Input images: Image 1 is the v1 Qwen capybara and project pixel-art style anchor; Image 2 is the user-provided headphones, white T-shirt and Qwen mark reference
Primary request: Create one complete standing capybara from ears to feet. Preserve the warm tan round head, rounded ears, small hair tuft, closed calm eyes, oval muzzle and cheek marks. Add large cyan headphones; one hand lightly touches an earcup and the other arm hangs naturally. Remove the bowl, spoon and food. Center the complete purple-blue Qwen graphic mark and the exact word "Qwen" on the white T-shirt, fully visible and unobstructed.
Style/medium: the same polished 2D pixel-art language, clustered pixels, dark stepped outline and soft upper-left lighting as v1
Composition/framing: complete ears, headphones, shirt, both legs and feet visible; centered with safe margins; a few detached pixel music notes may remain without touching or covering the character
Scene/backdrop: genuine transparent alpha; no scenery or floor
Text (verbatim): "Qwen"
Constraints: the chest graphic and text must be complete, accurate and unobstructed; no arm or object across the shirt; no crop, watermark, checkerboard or extra prop
Avoid: bowl, spoon, food, half-body crop, covered logo, misspelled text, smooth vector rendering, 3D render
```

内置输出为 1254 × 1254 RGB，并把灰白棋盘烘焙进背景。最终仅移除与画布边缘连通的浅灰棋盘背景，再以最近邻规范为 1024 × 1024 RGBA；人物内容没有手工重绘。
