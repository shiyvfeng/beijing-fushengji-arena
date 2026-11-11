# 北京浮生记 4:3 主视觉

## 交付文件

- `beijing-fushengji-hero-4x3-v1.png`
- `beijing-fushengji-hero-4x3-v2-kimi-no-feet.png`（当前修正版）
- 尺寸：1448 × 1086 px（4:3）
- 生成方式：内置 imagegen，五张角色图仅作为形象参考，未做素材拼贴或代码叠字

## 角色参考

1. `../codex-model-pets-v2/qwen-capybara.png`
2. `../codex-model-pets-v2/kimi-orb.png`
3. `../codex-model-pets-v2/deepseek-liang-wenfeng.png`
4. `../codex-model-pets-v2/anthropic-dario-amodei.png`
5. `../codex-model-pets-v2/gpt-5.6-sol-sam-altman.png`

## 最终提示词

```text
Use case: ads-marketing
Asset type: horizontal game key art / launch cover, 4:3 aspect ratio
Primary request: Generate a completely new static key visual from the five character reference images. The references are identity and character-design guides only; do not collage, trace, cut out, or reuse the source pixels. Five characters are standing in Zhongguancun, Beijing and all leap upward at the same moment in a dynamic fan-shaped formation, as if bursting out of the frame.
Input images:
Image 1: Qwen character reference — preserve the recognizable cute capybara, tan fur, cyan over-ear headphones, white Qwen T-shirt.
Image 2: Kimi character reference — preserve the recognizable glossy cobalt-blue orb/slime body and two simple white eyes; give it a clear upward-bouncing action.
Image 3: DeepSeek character reference — preserve the recognizable young East Asian man, short black hair, thin glasses, royal-blue blazer, pale-blue shirt, dark trousers.
Image 4: Dario character reference — preserve the recognizable curly dark hair, black rectangular glasses, gray chunky cardigan, dark trousers.
Image 5: Altman character reference — preserve the recognizable short wavy dark hair, clean-shaven face, navy suit and pale-blue shirt.
Scene/backdrop: Zhongguancun in Beijing, energetic urban commercial district. Perspective-warped glass office towers and electronics-era streetscape rise around and behind them. Add only one or two restrained game-world signs integrated on buildings, such as “人才市场” and “出租屋”; no other signage or brand clutter.
Subject placement: exact left-to-right order is Dario, Kimi, Qwen, DeepSeek, Altman. Qwen is largest and centered at the apex/front of the fan; Kimi and DeepSeek flank Qwen; Dario and Altman are the two outermost figures. Exactly five characters, all full-body or visibly airborne, each with a distinct joyful or determined jumping gesture. Nobody is hidden.
Style/medium: premium bright pixel-art-inspired game poster with richer contemporary illustration lighting and crisp readable silhouettes; retain the charming pixel-character identity but create a unified new scene. Bold Chinese indie-game key art, playful and cinematic.
Composition/framing: landscape 4:3. Dynamic diagonal high-angle/oblique overhead camera with dramatic ultra-wide lens distortion. Buildings and characters lean and stretch slightly toward the viewer, creating a pop-out-of-the-screen effect. Strong central depth, foreshortening, curved perspective lines, motion without blur. Keep safe margins; do not crop heads, hands, or feet. Characters occupy the lower-middle and center, skyline radiates upward behind them.
Lighting/mood: bright clear Beijing daylight, optimistic, humorous, adventurous, high energy.
Color palette: luminous sky blue, warm yellow-orange sunlight, saturated cyan and cobalt accents, clean reds in small amounts; bright and inviting, strong contrast.
Typography: integrate the title as an original part of the illustration, not an overlay or code composition. Place title clearly in the upper portion without covering faces. Main title must appear exactly once, large, bold, highly legible Chinese display lettering: “北京浮生记”. Subtitle must appear exactly once directly beneath it in smaller clear Chinese text: “大模型40天北漂生存挑战”. Ensure every Chinese character and the digits 40 are exact. No extra title text.
Constraints: output exactly one finished 4:3 image; exactly five characters; preserve each character’s recognizable design and the specified order; title and subtitle are natively generated in the artwork; one or two background signs maximum; no existing asset collage; no logos beyond the Qwen shirt design inherited from its character reference; no watermark.
Avoid: extra people or duplicates, missing characters, wrong character order, photorealistic faces, muddy/dark palette, flat straight-on camera, excessive signs, dense small text, misspelled Chinese, English copy, UI elements, borders, speech bubbles, motion blur, cropped limbs, source-image cutout edges.
```

## v2 局部编辑提示词

```text
Use case: precise-object-edit
Asset type: 4:3 horizontal game key art
Input images: Image 1 is the edit target and must remain the base image.
Primary request: Change only Kimi, the glossy cobalt-blue spherical character second from the left. Remove the two small blue foot-like/leg-like protrusions beneath the sphere. Kimi must be a completely pure, smooth, round floating ball with no feet, no legs, no arms, no hands, no appendages, and no tail. Reconstruct the small exposed background area naturally where those protrusions were removed, matching the existing sky, buildings, and white-blue upward motion trail.
Critical invariants: Preserve every other pixel-level visual feature as closely as possible. Keep Kimi's exact size, position, round silhouette except for removal of the two protrusions, cobalt-blue color, glossy highlight, and two white eyes. Keep Dario, Qwen, DeepSeek, and Altman completely unchanged in identity, anatomy, pose, clothing, scale, and position. Keep all buildings, perspective, lighting, colors, signs, and composition unchanged. Keep the 4:3 crop and 1448 × 1086 layout unchanged.
Text invariants: Preserve all text exactly, with identical wording, spelling, placement, color, and typography: “北京浮生记”, “大模型40天北漂生存挑战”, “人才市场”, “出租屋”, and the Qwen shirt lettering/logo. Do not redraw, replace, add, delete, or misspell any text.
Constraints: This is one localized removal only. No redesign, no restyling, no recomposition, no new elements, no extra characters, no watermark.
Avoid: any foot, leg, arm, hand, fin, nub, bump, appendage, or tail attached to Kimi; changes outside the immediate area beneath Kimi.
```
