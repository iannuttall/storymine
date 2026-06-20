# Agent Notes

This repo is a local-first research collection CLI and MCP server.

Build for two users:

- Humans: concise commands, clear privacy controls, useful markdown exports.
- Agents: structured JSON, deterministic commands, explicit limits, no prompts in JSON mode.

## Product Rules

- `research help` should stay short and useful.
- `research me apps`, `research me history`, and `research me transcripts` are the personal collectors.
- Personal collectors produce `signals`; only strong surfaced items become `candidates`.
- Transcript tooling must stream and checkpoint. Never load whole transcript trees into memory.
- Transcript audit output must be evidence-backed, redacted, and structured enough for another agent to act on.
- JSON mode is for agents and scripts. Never prompt when `--json` is used.
- Keep raw private content local. Exports should use summaries, references, and short paraphrased evidence.

## Repo Map

- `packages/core`: schemas, storage, collectors, transcript indexing, audit pipeline, export logic.
- `packages/cli`: `research` command and terminal output.
- `packages/mcp`: MCP stdio server exposing safe core tools.
- `plans`: product and implementation plans.

## Development Commands

Run from the repo root:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Use `pnpm exec biome format <files> --write` after edits. Avoid unrelated formatting churn.

## Style

- TypeScript ESM only.
- Prefer structured parsers over ad hoc string parsing.
- Keep CLI and MCP wrappers thin; put reusable behavior in `packages/core`.
- Use SQLite for checkpoints and durable local state.
- Use streaming reads for transcript files.
- Keep terminal output concise and action-oriented.
- Use ASCII unless the edited file already uses non-ASCII for a reason.
- Do not commit secrets, raw transcript exports, browser history dumps, or local DB files.

