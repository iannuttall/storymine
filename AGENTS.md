# Agent Notes

This repo is Storymine, a local-first CLI and MCP server. It audits recent Claude and Codex coding chats, cross-checks them against local work evidence, and returns a small set of strong blog ideas.

The main output is broader than prompting advice. It includes tools and features built, failures and breakthroughs, reusable technical or product lessons, repeated workflow observations, and user-selected topics such as marketing, SEO, or AI coding.

Build for two users:

- Humans: concise commands, clear privacy controls, readable markdown exports.
- Agents: structured JSON, deterministic commands, explicit limits, safe local data handling.

The product is still early, but the architecture rule is fixed: `packages/core` owns behaviour; CLI and MCP are first-party clients of core.

## Product Rules

- `storymine scan` is the main story workflow. `storymine work` is the model-free recent-work inventory. `storymine ideas` is the review queue.
- Get project locations from selected transcript metadata. Do not assume another user has `~/dev`, a `sandbox` directory, or Ian's project layout.
- Recent work evidence is deterministic: Git history, created files, package metadata, remotes, and configured site URLs.
- User interests come from `--topics` or `STORYMINE_TOPICS`. They add a bounded ranking boost; they are never hardcoded, never a hard filter, and never enough to rescue a weak story.
- A configured Git remote is not proof that a repository is public. Preserve visibility as unknown unless another source verifies it.
- Strong story findings require a concrete problem, failed approach, non-obvious move, reusable recipe, and observable proof.
- Reject routine edits and project summaries even when they mention real files.
- Transcript audit output must be evidence-backed, redacted, concise, and structured enough for another agent to act on.
- Idea output must be useful as draft-agent input without requiring raw transcript access.
- JSON mode is for agents and scripts. Never add prompts or human-only formatting when `--json` is used.
- Keep raw private content local. Do not commit transcript exports, browser history dumps, SQLite DBs, local configs, or logs.

## What The Miner Should Extract

Good ideas and observations look like:

- a tool or feature actually built during the selected window
- a declared repository, package, or site URL, with provenance and honest visibility caveats
- an interesting marketing, SEO, AI-coding, product, design, or technical lesson when it matches the current user's interests
- a failure-to-result arc with files, commands, checks, commits, metrics, or shipped output as evidence
- a reusable recipe that makes sense without the original repo or transcript
- repeated observations supported by more than generic model commentary

- prompt patterns users can paste tomorrow
- course corrections where the human stopped the AI going down the wrong path
- verification loops that forced the AI to inspect real data, files, UI, docs, or outputs
- scope-control moves that protected working code or narrowed the task
- agent failure modes such as overbuilding, cargo-culting, hallucinated certainty, weak defaults, generic copy, or shallow validation
- privacy/safety moves such as explicit do-not-mention lists or secret redaction habits
- context-management moves such as telling AI which examples are illustrative, not complete specs
- search/read moves such as making AI find exact prior examples before redoing research
- steering moves where the human stopped, redirected, pushed back on, or reminded the AI of a rule it missed
- intervention moments where the human caught AI drift, named the bad pattern, and forced a better next move
- technical lessons explained in plain English for smart beginners, not only developers
- repeated UI, performance, debugging, research, or workflow rules that could become future skills
- direct titles that name the exact prompt move, not slogans or vague contrast lines
- plain title words such as settings, outside service, old version, current system, saved results, and restartable work instead of developer shorthand

Weak findings:

- "Use this package/library/pattern" when that only matters to one repo
- "Write tests" without a sharper AI-specific lesson
- "Fix the bug" summaries
- architecture notes without a reusable prompting/workflow lesson
- private or identifying details
- anything requiring the original project context to understand
- claims that a configured remote or URL is publicly reachable without verification

## Current CLI Shape

Primary commands:

```bash
storymine scan
storymine work
storymine ideas
storymine doctor
storymine privacy
storymine mcp serve
```

Typical workflow:

```bash
storymine scan --days 14 --topics "marketing,seo,AI coding"
storymine work --days 14 --topics "marketing,seo,AI coding"
storymine ideas
storymine ideas approve <idea-id>
storymine ideas reject <idea-id>
storymine ideas --status all --json
```

Use `storymine help all` for the older low-level collectors, transcript search, finding review, and candidate export commands.

Transcript workflow:

```bash
storymine me transcripts index --provider claude --project binday --limit 10
storymine me transcripts parse --provider claude --limit 10 --maxTokens 2500
storymine me transcripts search --query "generic copy inspect screen" --project binday
storymine me transcripts read --session <session-id> --sequence <n>
storymine findings review --markdown --limit 10
storymine candidates promote --minConfidence 0.7 --limit 25
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
- Target audit batches with `--query`, `--project`, `--provider`, and `--status`.
- Duplicate chunk text hashes are skipped by default during audit selection; use `--includeDuplicates` only when repeated chunks are intentionally useful.

Search/read/corpus direction:

- Use exact history search before larger audits: locate sessions, scan chunks, then read only relevant parts.
- `research me transcripts search` returns chunk hits with session/file provenance.
- `research me transcripts show --chunk <id>` prints one chunk as markdown.
- `research me transcripts read --session <id> --sequence <n>` reads context around a session sequence.
- `research me transcripts export-corpus --output <dir>` materializes cleaned transcript chunks as markdown docs for a QMD-style semantic engine.
- Semantic search should find candidate moments, not replace exact transcript provenance.
- Keep audit mode focused on clean user/assistant chunks; history search mode may include tool, patch, and subagent parts.

Finding review:

- `research findings review --markdown` lists unreviewed findings for human assessment.
- `research findings approve --id <finding>` marks a strong reusable lesson.
- `research findings reject --id <finding>` marks weak, generic, or project-specific output.
- `research findings needs-work --id <finding>` marks useful-but-rough findings for later prompt/eval tuning.

## Repo Map

- `packages/core`: reusable product logic.
- `packages/cli`: `storymine` command and terminal output.
- `packages/mcp`: MCP stdio server exposing safe core tools.
- `skills`: repo-local Codex skills for using this tool from other agent sessions.
- `plans`: planning/spec documents.

Skills:

- `skills/storymine/SKILL.md`: main guide for agents scanning and reviewing story ideas.

Core areas:

- `packages/core/src/schemas.ts`: shared Zod schemas and TypeScript types.
- `packages/core/src/storage/database.ts`: SQLite schema, checkpoints, CRUD helpers.
- `packages/core/src/paths.ts`: local config/cache/log paths.
- `packages/core/src/system.ts`: privacy/doctor/reset helpers.
- `packages/core/src/scan.ts`: full v1 scan orchestration.
- `packages/core/src/work-scan.ts`: model-free recent-work orchestration shared by `work` and `scan`.
- `packages/core/src/ideas.ts`: safe idea listing and markdown output.
- `packages/core/src/artifacts/scan.ts`: portable project evidence, topic matching, and declared link discovery.
- `packages/core/src/artifacts/work.ts`: publish-safe recent-work records.
- `packages/core/src/collectors/app-usage.ts`: Screen Time collector.
- `packages/core/src/collectors/chrome-history.ts`: Chrome history collector.
- `packages/core/src/transcripts/discovery.ts`: Claude/Codex file discovery, project filters.
- `packages/core/src/transcripts/parser.ts`: focused Claude/Codex message parsing.
- `packages/core/src/transcripts/chunking.ts`: redacted transcript chunks.
- `packages/core/src/transcripts/redaction.ts`: secret/email redaction.
- `packages/core/src/transcripts/audit.ts`: prompting-alpha prompt, targeted audit selection, and command model adapter.
- `packages/core/src/transcripts/search.ts`: exact transcript chunk search/read helpers.
- `packages/core/src/transcripts/corpus.ts`: semantic-ready markdown corpus export.
- `packages/core/src/transcripts/review.ts`: finding review helpers.
- `packages/core/src/transcripts/processing.ts`: parse/index orchestration.
- `packages/core/src/transcripts/story-selection.ts`: deterministic preselection before model calls.
- `packages/core/src/transcripts/summarize.ts`: resumable session summaries.
- `packages/core/src/transcripts/stories.ts`: deep story mining.
- `packages/core/src/transcripts/story-eval-fixtures.ts`: reviewed strong/weak quality examples.
- `packages/core/src/candidates.ts`: promotion, dedupe, markdown/JSON export.

CLI areas:

- `packages/cli/src/index.ts`: root command registration.
- `packages/cli/src/args.ts`: shared argument parsing helpers.
- `packages/cli/src/utils.ts`: terminal output helpers.
- `packages/cli/src/commands/scan.ts`: small main scan command.
- `packages/cli/src/commands/work.ts`: deterministic recent-work command.
- `packages/cli/src/commands/ideas.ts`: idea listing and review.
- `packages/cli/src/commands/me.ts`: app/history/transcript commands.
- `packages/cli/src/commands/findings.ts`: finding review commands.
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
node dist/cli.js --help
node dist/cli.js scan --help
node dist/cli.js ideas --help
node dist/cli.js doctor
node dist/cli.js privacy
```

For a safe targeted transcript smoke test, use a scratch cache:

```bash
SCRATCH=$(mktemp -d /tmp/storymine-smoke-XXXXXX)
STORYMINE_CACHE_DIR="$SCRATCH/cache" \
STORYMINE_CONFIG_DIR="$SCRATCH/config" \
STORYMINE_LOG_DIR="$SCRATCH/logs" \
node dist/cli.js me transcripts index --provider claude --project binday --limit 5 --json
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
- Use `storymine privacy` to inspect local paths.
- Use `storymine reset --yes` to clear local Storymine state.
- Use `storymine me transcripts reset-audit --yes` to clear transcript findings/candidates and reset chunk audit status.

## Output Quality Bar

Before calling story output "good", check:

- Can someone understand and use the idea without knowing the original project?
- Does it name what was actually built or observed during the selected window?
- Is the failure or mistaken approach concrete?
- Is the non-obvious move genuinely different from routine advice?
- Is there a recipe another person could follow?
- Is there observable proof such as commits, passing checks, metrics, generated output, or a shipped result?
- Are repository and site links clearly labelled as declared or verified?
- Is evidence paraphrased and non-private?
- Are projects diversified so one busy repo does not dominate?
- Do user interests influence ranking without becoming a hard filter?
- Can a non-technical but serious reader understand why the idea matters?
- Could this become a reusable skill/checklist/rule for future agents?
- Does the title say the actual instruction, or is it just a friendly phrase?
- Does the title avoid unclear shorthand like infra, config, API, caveat, and feature parity?

The next major quality improvement should come from reviewed examples: run real scans, have the human mark strong/weak ideas, and add privacy-safe versions to the deterministic eval fixtures.

Reviewed prompt-alpha fixtures live in `packages/core/src/transcripts/eval-fixtures.ts`.
Use them when tuning extraction prompts. They intentionally focus on human
intervention moments: stop, steer, pushback, reminder, scope-reset, and
validation-demand.

Reviewed story fixtures live in `packages/core/src/transcripts/story-eval-fixtures.ts`. Every strong fixture must pass the deterministic gate and every weak fixture must fail it.
