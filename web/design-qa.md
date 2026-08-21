# Arena Design QA

Final result: passed

## Reference and implementation evidence

- Source references: `design/imagegen-shared-interview-stage-2026-08-20/03-dark-prices-and-ticker.png` and `design/imagegen-shared-interview-stage-2026-08-20/04-dark-actions-and-event.png`.
- Presentation-layer capture, 1920×1080, Day 33 (development fallback): [`qa-day33-1920x1080-final.png`](./qa-day33-1920x1080-final.png).
- Presentation-layer capture, 1366×768, Day 40 after one finale item reveal (development fallback): [`qa-day40-1366x768.png`](./qa-day40-1366x768.png).
- Earlier focused source/implementation comparison: [`qa-compare-source-implementation.png`](./qa-compare-source-implementation.png).
- Density: native browser density, no page zoom.

## States checked

- Opening screen and content notice.
- Day 1 opening transition.
- Day 33 prices, current-fact price highlight, inspection event, shared stage, interviews, timeline, controls, chart, status and actions.
- Day 40 locked-to-revealed finale transition; four sealed items become visible one at a time.
- Agent detail dialog with cash and bank separated.
- 1366×768 and 1920×1080 layouts; no document-level horizontal or vertical overflow at either target size.

## Interaction and accessibility checks

- Direct future jump says “揭示至第 N 天”; day scale and previous/next controls share the same date cursor.
- Left/Right arrow day navigation and Escape close were exercised.
- Agent dialog initially focuses the close button, traps Tab within the dialog, and returns focus to the originating Agent card on close.
- Stage tabs use roving `tabIndex`, `aria-controls` / `aria-labelledby`, and Left/Right switching without changing the replay day.
- Day 39/future-final and prediction-maturity redaction are covered by automated tests.
- The chart exposes a text equivalent for all four current net-worth values.
- Replay hash is visible in the header and exposes the full value through its title.
- `prefers-reduced-motion` disables nonessential transitions.
- At 1920×1080, the measured primary price/event/speech text is 18px and the key net-worth figure is 28px.

## Console and build checks

- The final `dist/arena-demo/replay.html` was also exercised with the injected core `MatchReplay` at 1366×768 and 1920×1080. The browser showed “核心回放”, the exact full Replay hash in the header title, Day 1/39/40, the locked-to-revealed finale transition, separated cash/bank fields, and dialog focus return; the fresh console contained no warning or error.
- Final-artifact QA found that build-time image inlining changes manifest paths to `data:image`; the runtime validator originally rejected those paths and blanked the page. The validator now accepts only local `./assets/` paths or build-inlined image data URIs, with a dedicated regression test.
- `npm run typecheck`, 9 Web Node tests, 14 Core Node tests, `npm run build`, and the root `npm run build:arena` scripted-core/offline integration completed successfully.
