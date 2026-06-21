# Agent Notes

This repo is a local-first research collection CLI and MCP server. It turns local personal signals and AI transcript audits into high-quality candidates for newsletters and product-building content.

The ultimate goal is an ongoing CLI workflow that humans or agents can schedule to audit past AI chats and extract hard-won prompting lessons: high-agency, non-obvious ways to steer AI while building real products every day.

Build for two users:

- Humans: concise commands, clear privacy controls, readable markdown exports.
- Agents: structured JSON, deterministic commands, explicit limits, safe local data handling.

The product is still early, but the architecture rule is fixed: `packages/core` owns behaviour; CLI and MCP are first-party clients of core.

## Product Rules

- `research me apps`, `research me history`, and `research me transcripts` are the personal collectors.
- Personal collectors create `signals`; transcript audits create `transcript_findings`; only strong findings become `candidates`.
- The transcript auditor is looking for prompting alpha, not project summaries.
- Good findings should help a broad audience prompt AI better tomorrow.
- Reject project-specific implementation notes unless they translate into a reusable human move.
- Transcript audit output must be evidence-backed, redacted, concise, and structured enough for another agent to act on.
- Candidate exports should be useful as draft-agent input without requiring raw transcript access.
- JSON mode is for agents and scripts. Never add prompts or human-only formatting when `--json` is used.
- Keep raw private content local. Do not commit transcript exports, browser history dumps, SQLite DBs, local configs, or logs.

## What The Auditor Should Extract

Good transcript findings look like:

- prompt patterns users can paste tomorrow
- course corrections where the human stopped the AI going down the wrong path
- verification loops that forced the AI to inspect real data, files, UI, docs, or outputs
- scope-control moves that protected working code or narrowed the task
- agent failure modes such as overbuilding, cargo-culting, hallucinated certainty, weak defaults, generic copy, or shallow validation
- privacy/safety moves such as explicit do-not-mention lists or secret redaction habits
- context-management moves such as telling AI which examples are illustrative, not complete specs
- search/read moves such as making AI find exact prior examples before redoing research

Weak findings:

- "Use this package/library/pattern" when that only matters to one repo
- "Write tests" without a sharper AI-specific lesson
- "Fix the bug" summaries
- architecture notes without a reusable prompting/workflow lesson
- private or identifying details
- anything requiring the original project context to understand

## Current CLI Shape

Root commands:

```bash
research candidates
research doctor
research mcp
research me
research privacy
research reset
```

Transcript workflow:

```bash
research me transcripts index --provider claude --project binday --limit 10
research me transcripts parse --provider claude --limit 10 --maxTokens 2500
research me transcripts audit --limit 5 --timeoutSeconds 180
research candidates promote --minConfidence 0.7 --limit 25
research candidates export --format markdown --limit 25
```

Project targeting:

- `--project <text>` matches transcript file paths, Claude project folder names, and Codex `cwd/title` metadata.
- Comma-separated values are allowed.
- Claude `agent-*.jsonl` auxiliary logs are excluded by default.
- Use `--includeAuxiliary` only when auxiliary logs are explicitly needed.

Candidate promotion:

- `packages/core/src/candidates.ts` groups semantic repeats before promotion.
- Duplicate findings attach to the same candidate and merge evidence.
- `--maxPerAlphaType` caps one alpha type from dominating exports.
- `--force` rebuilds candidates for already-promoted findings.

Audit model command:

- Default: `codex exec --ephemeral -`.
- Keep `--ephemeral` so audit runs do not write new Codex sessions that pollute future transcript search.
- Override with `--command "claude -p"` or another stdin-reading model command when explicitly needed.

Search/read direction:

- Add an exact history-search layer before larger audits: locate sessions, scan parts, then read only relevant parts.
- Add a semantic layer later by materializing cleaned transcript parts as markdown-like docs that can be indexed by a QMD-style local engine.
- Semantic search should find candidate moments, not replace exact transcript provenance.
- Keep audit mode focused on clean user/assistant chunks; history search mode may include tool, patch, and subagent parts.

## Repo Map

- `packages/core`: reusable product logic.
- `packages/cli`: `research` command and terminal output.
- `packages/mcp`: MCP stdio server exposing safe core tools.
- `skills`: repo-local Codex skills for using this tool from other agent sessions.
- `plans`: planning/spec documents.

Skills:

- `skills/research/SKILL.md`: broad guide for agents using the CLI/MCP to collect signals, audit transcripts, promote candidates, and export feeds.

Core areas:

- `packages/core/src/schemas.ts`: shared Zod schemas and TypeScript types.
- `packages/core/src/storage/database.ts`: SQLite schema, checkpoints, CRUD helpers.
- `packages/core/src/paths.ts`: local config/cache/log paths.
- `packages/core/src/system.ts`: privacy/doctor/reset helpers.
- `packages/core/src/collectors/app-usage.ts`: Screen Time collector.
- `packages/core/src/collectors/chrome-history.ts`: Chrome history collector.
- `packages/core/src/transcripts/discovery.ts`: Claude/Codex file discovery, project filters.
- `packages/core/src/transcripts/parser.ts`: focused Claude/Codex message parsing.
- `packages/core/src/transcripts/chunking.ts`: redacted transcript chunks.
- `packages/core/src/transcripts/redaction.ts`: secret/email redaction.
- `packages/core/src/transcripts/audit.ts`: AI-usage-alpha prompt and command model adapter.
- `packages/core/src/transcripts/processing.ts`: parse/index orchestration.
- `packages/core/src/candidates.ts`: promotion, dedupe, markdown/JSON export.

CLI areas:

- `packages/cli/src/index.ts`: root command registration.
- `packages/cli/src/args.ts`: shared argument parsing helpers.
- `packages/cli/src/utils.ts`: terminal output helpers.
- `packages/cli/src/commands/me.ts`: app/history/transcript commands.
- `packages/cli/src/commands/candidates.ts`: promote/list/export commands.
- `packages/cli/src/commands/system.ts`: privacy/doctor/reset commands.
- `packages/cli/src/commands/mcp.ts`: MCP command helpers.

MCP areas:

- `packages/mcp/src/index.ts`: MCP server construction.

## Development Commands

Run from the repo root:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Use Biome:

```bash
pnpm lint:fix
```

Useful CLI smoke checks:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js privacy
node packages/cli/dist/index.js me transcripts --help
node packages/cli/dist/index.js candidates --help
```

For a safe targeted transcript smoke test, use a scratch cache:

```bash
SCRATCH=$(mktemp -d /tmp/research-smoke-XXXXXX)
RESEARCH_CACHE_DIR="$SCRATCH/cache" \
RESEARCH_CONFIG_DIR="$SCRATCH/config" \
RESEARCH_LOG_DIR="$SCRATCH/logs" \
node packages/cli/dist/index.js me transcripts index --provider claude --project binday --limit 5 --json
rm -rf "$SCRATCH"
```

## Code Style

- TypeScript ESM only.
- Prefer structured parsers over ad hoc string parsing.
- Keep CLI/MCP wrappers thin; put reusable behaviour in `packages/core`.
- Use SQLite for checkpoints and durable local state.
- Use streaming or bounded reads for transcript files. Do not load whole transcript trees blindly.
- Keep terminal output concise and action-oriented.
- Use ASCII unless the edited file already uses non-ASCII for a reason.
- Add tests when changing parsing, redaction, storage, audit prompts, dedupe, or exported output shape.

## Privacy And Safety

- Treat transcript files, browser history, and app usage as private by default.
- Never commit local DBs, logs, raw transcript exports, Chrome history copies, local config, OAuth tokens, or secrets.
- Do not paste raw transcript chunks into docs or final answers.
- Evidence in candidates should be short paraphrases.
- Model audit prompts should receive redacted chunks only.
- Use `research privacy` to inspect local paths.
- Use `research reset --yes` to clear local research state.
- Use `research me transcripts reset-audit --yes` to clear transcript findings/candidates and reset chunk audit status.

## Output Quality Bar

Before calling candidate output "good", check:

- Can someone use the tip without knowing the original project?
- Is the prompting move concrete?
- Is the mistake to avoid named clearly?
- Is there an example prompt they could paste?
- Is evidence paraphrased and non-private?
- Are duplicates collapsed?
- Is the export varied across alpha types?

The next major quality improvement should come from reviewed examples: run more real project audits, have the human mark strong/weak findings, then add those examples back into the audit or curation prompt.
