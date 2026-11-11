# 来源与冻结边界

## Replay UI

- 来源 workspace：`/Users/dahai/Project/beijing-fushengji-arena-replay-ui`
- 来源分支：`codex/replay-ui`
- 来源提交：`708d48d4d6bf82da04d04e769fbc8ddcb0ef3e67`
- 与 Arena Runner 的共同基线：`cce2f24de8d3a9a13e74f08854a84561ac13e091`
- 导入方式：从提交对象提取白名单文件，不读取工作树中的 `.DS_Store` 变化。

Showcase 新仓在白名单源码上保留四类明确、可审计的本地差异：

- `scripts/build-arena-replay.mjs` 与 `web/vite.config.ts`：离线 Replay 构建改用单入口，避免双入口公共 chunk 残留在单文件 HTML 中。
- `scripts/run-arena-browser-acceptance.mjs`：把 Chromium 缺失时的安装提示对齐到新仓实际提供的 `npm run browser:install`。
- `web/package.json` 与 `web/package-lock.json`：补齐独立类型检查所需的 `@types/node`；Vite `6.4.2 → 6.4.3`，并通过非 force 修复把 nanoid 升至 `3.3.18`、PostCSS 升至 `8.5.26`。根目录与 Web 的最终 `npm audit` 均为 0。
- 新增根目录私有 package、冻结校验脚本、来源/样本/证据清单；这些只服务离线 Showcase，不引入 Runner 或 Provider 能力。
- 最终 release 与正式浏览器验收均由新仓源码生成；不会回写来源 workspace。

## Gold1

- Track：`completion-assisted-v1`
- Match ID：`arena-completion-assisted-v1-prompt-v2-run-001-attempt-003`
- Seed：`2026082301`
- Rotation：`0`
- Runner 输出来源：`/Users/dahai/Project/beijing-fushengji-arena/dist/arena-completion-assisted/run-001-prompt-v2-attempt-003`
- Diagnostics 来源：`/Users/dahai/Project/beijing-fushengji-arena/dist/arena-diagnostics/arena-completion-assisted-v1-prompt-v2-run-001-attempt-003`

Gold1 在原仓未绑定精确 Git/source SHA。它运行时使用过尚未提交的 Stability waiver 代码，相关能力随后才提交，因此不能把任何单一 commit 宣称为已证明的精确运行源码。Showcase 以冻结工件及其 SHA-256 为权威输入；完整 Runner 工程仍保留在原 workspace。

Gold1 原始 `replay.html`、`browser-acceptance.json` 和失败 artifacts 作为历史证据完整归档。旧报告为 `4/14 failed`，不得充当 Showcase 通过证据；新 Adapter 的报告必须写入新仓 `work/`/`evidence/`。

## Gold2

- Track：`completion-assisted-v1`
- Match ID：`arena-completion-assisted-v1-high-effort-run-002-attempt-004`
- Seed：`2026082302`
- Rotation：`1`
- Runner 输出来源：`/Users/dahai/Project/beijing-fushengji-arena/dist/arena-completion-assisted/run-002-high-effort-attempt-004`
- Diagnostics 来源：`/Users/dahai/Project/beijing-fushengji-arena/dist/arena-diagnostics/arena-completion-assisted-v1-high-effort-run-002-attempt-004`
- 运行源码基线：Arena `8b8c3496a215b60828d33094e10deb9683542970` 加运行时未提交 patch SHA-256 `13fb7e0fed9673fa54bd79d0377b8687f316fa9b76e493a1b7c843794475cf5d`
- 等价源码树：上述同一 patch 在比赛结束后提交为 `60e39f51de876056bab003a509a6fc51499c0f20`；不能反向宣称比赛运行时已经位于该 commit。

Gold2 已在进程结束、目录稳定后完整搬入：Runner 输出 40 个文件，diagnostics 208 个文件（Probe 5、Match 203；Stability 被显式跳过，因此源目录没有 Stability exchanges，也不补造空目录）。所有 Authorization 与 Set-Cookie 字段均为 `[REDACTED]`，冻结清单覆盖全部 248 个源文件。

Replay 为合法 `arena-schema-v4`、五个唯一 Provider + model、连续 Day 1–40。四个模型完成到 Day 40；Qwen 第 32 天游戏内死亡；没有技术 DNF。Probe 因 DeepSeek `incomplete` 未通过但有显式 waiver，Stability 经显式授权跳过并有 waiver；这些门禁事实不得描述成通过。

Gold2 原始 `replay.html`、`browser-acceptance.json` 与失败 artifacts 继续作为历史记录归档。旧报告为 `4/14 failed`，不得充当 Showcase 通过证据；新仓报告单独保存在 `evidence/gold-002/`。

## 传播边界

仓库、素材、BGM、raw exchanges 和 release 均仅用于私有展示，不公开、不分发。`archive/` 绝不能复制到 `web/public/` 或任何 release 目录。
