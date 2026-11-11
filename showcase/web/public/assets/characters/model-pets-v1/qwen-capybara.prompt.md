# Qwen 卡皮巴拉像素桌宠提示词

## 参考图角色

- 用户提供的 Qwen 卡皮巴拉原型：身份、头部、表情、白色上衣、碗和勺子参考。
- 初版 Qwen 图：调整目标。
- DeepSeek / 梁文锋图：仅作为像素密度、轮廓和全身比例参考。

## 最终全身调整提示词

```text
Use case: precise-object-edit
Asset type: corrected full-body single-frame Codex desktop pet master
Primary request: Extend the approved Qwen pixel mascot into a complete standing full-body character. Preserve the large round tan head, rounded ears, short three-bump hair tuft, closed curved eyes, oval brown muzzle, tiny nose and mouth line, cheek whisker marks, plain white short-sleeve T-shirt, pale blue bowl and small spoon. Add the missing lower torso, two short sturdy capybara legs and two simple rounded dark-brown feet. The legs and feet must visibly support the character and match the same warm tan/brown pixel palette.
Composition/framing: recompose the complete character within a square canvas so the top tuft, both ears, bowl, spoon, entire shirt, both legs and both feet are fully visible; centered; full-body height about 75 percent; at least 12 percent transparent safety margin
Scene/backdrop: genuinely transparent background with preserved alpha; no scenery and no floor
Style/medium: polished 2D pixel-art Codex desktop pet, crisp clustered pixels, dark brown/navy outline, compact chibi proportions, readable at 192x208
Lighting/mood: soft upper-left pixel lighting and peaceful expression
Text: none
Constraints: exactly one connected character; bowl and spoon remain attached to the pose; no crop, logo, shirt symbol, text, watermark, shadow, platform, glow, aura, detached effect, checkerboard, background, scenery, UI or border
Avoid: half-body crop, body ending at shirt hem, realistic human legs, four-legged stance, shoes, extra limbs, open eyes, changed bowl, changed face, 3D render or smooth vector lines
```

最终图按用户追加反馈补齐下半身、双腿和脚；生成器输出的假棋盘背景随后只做确定性 Alpha 提取，没有拼贴或手工重画。
