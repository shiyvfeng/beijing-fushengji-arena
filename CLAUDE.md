# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Beijing Fushengji MCP (北京浮生记) — a turn-based trading game engine built as an MCP Server. Players control "Tie Niu" (铁牛), buying/selling goods to repay debt within 40 days in Beijing. Designed for LLMs to play as autonomous agents via MCP tools.

**GitHub**: https://github.com/shiyvfeng/beijing-fushengji-MCP

## Build & Run

```bash
npm install      # install dependencies
npm run build    # tsc → compiles src/ to dist/
npm start        # node dist/index.js (MCP server over stdio)
```

No test runner or linter is configured.

## Architecture

Four source files with clear separation of concerns:

- **`src/types.ts`** — Interfaces: `Drug`, `MarketEvent`, `HealthEvent`, `StealEvent`, `Location`, `GameState`, `GameResponse`
- **`src/game-data.ts`** — Static constants: 8 products (`DRUGS`), 18 market events, 12 health events, 7 steal events, 20 locations (10 subway + 10 surface), and game balance constants (40 days, 10% daily debt interest, 3500/hp hospital cost, etc.)
- **`src/game-engine.ts`** — `GameEngine` class: stateful single-instance engine. Public API: `startGame`, `move`, `buy`, `sell`, `bankDeposit`, `bankWithdraw`, `repayDebt`, `hospital`, `rentHouse`, `getStatus`. Per-move sequence: generate prices → apply interest → trigger market events → record history → trigger health/steal events → check game-end
- **`src/index.ts`** — MCP server entry point. Registers 9 tools (`start_game`, `move`, `buy`, `sell`, `bank`, `repay_debt`, `hospital`, `rent_house`, `get_status`) using `@modelcontextprotocol/sdk` with Zod parameter schemas. Transport: `StdioServerTransport`. McpServer includes `description` field that instructs AI to play autonomously.

## Key Patterns

- **Stateful engine**: `GameEngine` holds a single `GameState` instance; `ensureGame()` guards all operations
- **Event systems**: Three independent random event systems (market/health/steal) triggered each turn via frequency-based rolls: `!(randomNum(1000) % freq)`
- **Compound interest**: Debt grows 10%/day, bank earns 1%/day — applied on every `move()`
- **Consistent response envelope**: All tools return `GameResponse` with `{success, message, events[], state, gameOver, score}`
- **All game text is in Chinese** (zh-CN)
- **Autonomous play**: SKILL.md contains explicit instructions for AI agents to play the full 40-day game autonomously without waiting for user input each turn

## OpenClaw Integration

This project is deployed as an OpenClaw Skill:

- **Skill symlink**: `~/.openclaw/skills/beijing-fushengji-mcp` → project directory
- **MCP routing**: configured in `~/.openclaw/workspace/config/mcporter.json`
- **SKILL.md**: frontmatter (`name`, `description`) + game rules + autonomous play instructions
- **Gateway restart** required after code changes: `openclaw gateway restart`

## Tech Stack

- TypeScript 5.8 (ES2022 target, Node16 ESM modules)
- `@modelcontextprotocol/sdk` for MCP protocol
- `zod` for tool parameter validation
- No database — all state is in-memory

## Git Conventions

- Remote: `origin` → GitHub
- Main branch: `main`
- Commit messages in English, code/game text in Chinese
