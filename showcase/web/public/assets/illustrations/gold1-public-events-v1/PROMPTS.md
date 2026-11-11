# Gold1 公共事件素材 v1 · 提示词记录

每张图片均通过一次独立的 Codex built-in ImageGen 调用生成。输入图片 `../arena-stage-zhongguancun-2000s-v1.png` 只作为画风参考，不是编辑目标。

## 共享提示词

```text
Use case: historical-scene
Asset type: standalone 3:2 candidate illustration for the Gold1 public-event panel; this is a new asset, not an edit
Input image: Image 1 is STYLE REFERENCE ONLY. Match its polished retro 2D pixel-art language, crisp readable pixel clusters, early-2000s Beijing urban detail, warm nostalgic game-background quality, perspective, and material rendering. Do not copy the exact storefront layout.
Composition/framing: landscape 3:2, eye-level editorial scene, one strong readable focal point, safe for object-fit cover at about 360x210
Period: Beijing around 2000; era-appropriate clothing, streets and retail fixtures
Constraints: no UI, no captions, no speech bubbles, no readable signs, no Chinese or Latin letters, no numbers, no logos, no trademarks, no watermark, no modern smartphones, no photorealism, no 3D render, no recognizable real public figure. All packages, labels and printed material must be completely blank or use only abstract non-letter color shapes.
```

`market-01` 和 `market-04` 的生成调用还在共享约束中明确了 CRT 时代技术；`market-01`、`market-04`、`market-05` 的首批调用使用了语义等价的较短包装约束。

## 各事件追加提示词

### market-01

```text
Primary request: illustrate the actually occurring Gold1 public event in which an expert promotes university students' hands-on skills and imported toys suddenly become popular.
Scene: a university courtyard activity booth near Zhongguancun. Several early-2000s college students enthusiastically assemble imported mechanical toys, model kits, gears and remote-control parts on a long table while a generic older academic gestures approvingly beside a simple chalkboard with diagrams but absolutely no readable text. Nearby shoppers examine boxed toys with blank packaging.
Mood/palette: bright afternoon, lively and optimistic; warm cream, sky blue, leafy green, restrained red and yellow toy accents.
Narrative invariant: clearly communicate hands-on toy enthusiasm and rising toy demand; do not add unrelated goods or market events.
```

### market-04

```text
Primary request: illustrate the actually occurring Gold1 public event in which a dismissive street customer ignores a prestigious literature award and chooses pirated Hong Kong/Taiwan VCD movies instead.
Scene: an early-2000s sidewalk media stall. A generic scruffy customer waves away a tasteful hardcover book display and eagerly reaches toward stacks of shiny unlabeled VCD cases featuring only abstract color blocks and silhouettes. The books and discs are clearly distinct; no title text anywhere.
Mood/palette: satirical street-market energy, warm afternoon with slightly cheeky humor; faded cyan, brick red, cream paper, iridescent disc highlights.
Narrative invariant: visual contrast between ignored literature and crowded pirated VCD demand; no award insignia, no readable cover text, no recognizable actor.
```

### market-05

```text
Primary request: illustrate the actually occurring Gold1 public event in which a sensational newspaper editorial encourages smuggled-car consumption and demand for imported cars rises.
Scene: a Beijing curbside used-car lot around 2000 with several boxy period imported sedans. A generic newspaper hawker holds up a folded newspaper whose pages contain only abstract blocks and blank columns; interested customers crowd around a car while a salesman opens the hood. The vehicles have blank plates and no badges.
Mood/palette: bustling, slightly absurd promotional excitement, crisp sunny day; pale asphalt, cream newspaper, muted teal, maroon and silver cars.
Narrative invariant: editorial hype visibly drives attention toward smuggled imported cars; no readable headline, no official endorsement, no modern vehicles.
```

### market-06

```text
Primary request: illustrate the actually occurring Gold1 public event in which a sensational beauty editorial causes low-quality cosmetics to become extremely popular.
Scene: a lively early-2000s street cosmetics counter. A generic newspaper vendor holds a folded paper with only blank columns and abstract rectangles while a crowd eagerly buys visibly cheap lipstick, powder compacts and cream jars in plain unbranded packaging. A mirror and crowded trays make the beauty-shopping theme immediate.
Mood/palette: satirical yet friendly commercial excitement; sunlit cream and dusty rose with cyan storefront shadows.
Narrative invariant: editorial hype visibly triggers a rush for poor-quality cosmetics; do not show injuries or unrelated products.
```

### market-07

```text
Primary request: illustrate the actually occurring Gold1 public event in which even an online bookstore refuses to sell a controversial rare book, making the book extremely expensive on the black market.
Scene: a dim back corner of an early-2000s Zhongguancun electronics market. A beige CRT computer displays only a generic empty webpage layout with abstract blocks and no text. In the foreground, a discreet seller reveals one sealed, completely blank hardcover book from under a counter while several buyers offer thick stacks of cash; an empty bookshelf and a closed parcel reinforce scarcity.
Mood/palette: secretive and tense but nonviolent; navy shadows, amber tungsten pools, muted burgundy and paper cream.
Narrative invariant: online refusal, rarity and high black-market value must read visually; no book title, website name, readable price or illegal instruction.
```

### market-08

```text
Primary request: illustrate the actually occurring Gold1 public event in which a flamboyant generic celebrity boasts about using low-quality cosmetics at a gala, causing those cosmetics to sell out.
Scene: a small early-2000s entertainment gala stage with velvet curtains. A fictional stylish male performer in a shiny suit proudly applies overly bright face powder and lipstick while photographers react; nearby, a street cosmetics stall is overwhelmed by excited buyers grabbing plain unbranded products from nearly empty shelves.
Mood/palette: theatrical, humorous, high-energy; warm gold spotlights, magenta accents, deep blue shadows.
Narrative invariant: celebrity-like endorsement visibly causes a cosmetics rush; the performer must not resemble any real person; no speech bubble or readable media branding.
```

### market-09

```text
Primary request: illustrate the actually occurring Gold1 public event in which news of people binge-drinking counterfeit Shanxi liquor sends the resale value of fake baijiu soaring.
Scene: an early-2000s Beijing night-market liquor stall. A chaotic but nonviolent group of generic adults raises small ceramic cups while a worried vendor guards a tiny remaining stock of plain white ceramic liquor bottles. Several eager buyers hold thick stacks of cash toward the scarce bottles. One bottle is dramatically lit as the prized commodity.
Mood/palette: absurd speculative frenzy with cautionary undertone; amber lamps, navy night shadows, porcelain white and muted red accents.
Narrative invariant: visibly connect reckless counterfeit-liquor craze, scarcity and sky-high resale demand; no intoxicated injury, no real liquor brand, no readable price.
```

### market-10

```text
Primary request: illustrate the actually occurring Gold1 public event in which Beijing university students begin job hunting and gray-market mobile phones become highly popular.
Scene: outside an early-2000s Beijing job fair. Young graduates in simple jackets hold blank resumes and folders while crowding a street electronics counter to inspect chunky button mobile phones with tiny monochrome screens. A bulletin board in the background contains only blank rectangles and pins, no text.
Mood/palette: hopeful but pressured job-search bustle; bright overcast daylight, cream paper, muted blue jackets, teal and silver phone accents.
Narrative invariant: job hunting and strong demand for gray-market feature phones must both be obvious; no modern touchscreen device, no company branding.
```

### market-12

```text
Primary request: illustrate the actually occurring Gold1 public event in which the market is flooded with smuggled cigarettes arriving from Fujian.
Scene: a crowded early-2000s wholesale alley in Beijing. Porters unload many plain unbranded cigarette cartons from a small period delivery van while vendors rapidly stack loose packs across several stalls; the abundance visibly overwhelms the narrow market lane. Packages use only simple solid color bands with no letters or logos.
Mood/palette: busy supply glut, slightly clandestine but nonviolent; dusty afternoon light, cardboard brown, faded red and green bands, cool alley shadows.
Narrative invariant: an obvious flood of cigarette supply entering the market; no smoking glamour, no weapons, no police raid, no readable shipping mark.
```

### market-13

```text
Primary request: illustrate the actually occurring Gold1 public event in which Beijing children are busy studying online and imported toys receive almost no interest.
Scene: an early-2000s neighborhood computer classroom visible through large windows. Many schoolchildren sit intently at beige CRT computers with screens showing only abstract learning diagrams and shapes. In the foreground outside, a toy seller waits alone beside untouched imported toy boxes in plain blank packaging, looking disappointed; no children approach the toys.
Mood/palette: calm, lightly ironic contrast; clear afternoon, warm cream computers, school blue, leafy green, subdued toy colors.
Narrative invariant: online study is busy and popular while the imported toy stall is clearly ignored; do not portray toy buying or a lively toy crowd.
```

### market-14

```text
Primary request: illustrate the actually occurring Gold1 public event in which Zhongguancun's piracy trade booms and the market is crowded with women from nearby villages selling pirated VCDs.
Scene: a bustling early-2000s Zhongguancun media market. Several generic rural women in practical patterned jackets and simple headscarves confidently run long street tables overflowing with unlabeled VCD cases and shiny optical discs; customers crowd around buying. CRT monitors and beige computers in surrounding shops establish the Chinese Silicon Valley setting.
Mood/palette: energetic, satirical street-commerce bustle; bright daylight with warm red awnings, cream buildings, indigo jackets and iridescent disc highlights.
Narrative invariant: booming pirated-VCD trade led by multiple women vendors must be unmistakable; portray vendors with dignity, not as caricatures; no readable signage, no recognizable movie artwork, no brand marks.
```
