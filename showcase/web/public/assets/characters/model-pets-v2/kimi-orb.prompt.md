# Kimi 圆球像素立绘提示词 v2

```text
Use case: precise-object-edit
Asset type: complete transparent pixel-art game mascot sprite
Input images: Image 1 is the v1 Kimi orb and project pixel-art style anchor; Image 2 is the user-provided round shape, dark outer rim, blue inner glow and eye-placement reference
Primary request: Preserve one complete simple blue luminous round orb as the entire character. Keep the deep navy outer pixel rim, electric-blue body, soft cyan inner glow and a small upper-left highlight. Include exactly two equal narrow vertical white capsule eyes. Place the paired eyes clearly in the orb's upper-right area rather than at the center, with their pair center approximately 20 percent to the right and 25 percent above the orb center.
Style/medium: the same polished 2D pixel-art language, clustered pixels and compact silhouette as v1
Composition/framing: the entire circular body is visible with safe margins on every side
Scene/backdrop: genuine transparent alpha; no scenery or floor
Constraints: exactly one connected orb and two white vertical eyes in the upper-right area; no mouth, limbs, text, logo, watermark, shadow, checkerboard or detached effect
Avoid: centered eyes, face panel, smile, hands, feet, ring, crescent shape, glossy 3D rendering
```

内置输出本身包含 Alpha。最终清除边缘不可见的 Alpha 噪点，并以最近邻规范为 1024 × 1024 RGBA；球体内容没有手工重绘。
