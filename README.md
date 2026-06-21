# research

Local-first research collection CLI and MCP server for turning personal work signals into newsletter-ready ideas.

`research` looks at local signals such as app usage, Chrome history, and AI coding transcripts. It filters private/noisy material, extracts reusable lessons, promotes the strongest findings into candidates, and exports structured markdown or JSON that another agent can use.

The main goal is not "summarize what happened in a project". The goal is an ongoing CLI workflow that can be scheduled by humans or agents to audit past AI chats and extract hard-won prompting lessons: high-agency, non-obvious ways to steer AI while building real products every day.

## What It Does

- Collects Screen Time app usage signals from the local Mac.
- Collects Chrome history signals while filtering localhosts, dashboards, inboxes, and other noise.
- Indexes Claude and Codex transcript files incrementally.
- Parses transcripts into focused user/assistant chunks, excluding system prompts, duplicated event messages, and chain-of-thought noise.
- Redacts obvious secrets before audit prompts leave the machine.
- Searches and reads cleaned transcript chunks with exact session/file provenance.
- Exports cleaned chunks as markdown corpus files for a future semantic index.
- Audits transcript chunks with a local model command. The default is `codex exec --ephemeral -`.
- Extracts evidence-backed prompting findings.
- Provides a review queue so humans can approve/reject findings before promotion.
- Promotes high-confidence findings into newsletter-shaped candidates.
- Dedupes repeated findings and merges evidence from similar transcript moments.
- Exposes the same core through CLI and MCP.

## Start Here

From source:

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js --help
```

If linked locally, use:

```bash
research --help
research doctor
research privacy
```

## Main Workflow

Collect quick personal context:

```bash
research me apps --days 7
research me history --days 7
```

Run a small transcript audit:

```bash
research me transcripts index --provider claude --project binday --limit 10
research me transcripts parse --provider claude --limit 10 --maxTokens 2500
research me transcripts search --query "generic copy inspect screen" --project binday
research me transcripts read --session <session-id> --sequence <n>
research me transcripts audit --limit 5 --timeoutSeconds 180
research findings review --markdown --limit 10
research findings approve --id <finding-id>
research candidates promote --minConfidence 0.7 --limit 25
research candidates export --format markdown --limit 25
```

Override the model command when needed:

```bash
research me transcripts audit --command "claude -p" --limit 5
research me transcripts audit --command "codex exec --ephemeral -" --limit 5
```

Target audits with the same filters used by search:

```bash
research me transcripts audit --query "overbuilt" --project tidechecker --limit 5
research me transcripts audit --provider codex --status failed --limit 5
```

Use `--project` to target transcript paths, Claude project folder names, or Codex `cwd` metadata:

```bash
research me transcripts index --project binday
research me transcripts index --project tidechecker
research me transcripts index --provider codex --project /Users/iannuttall/workers/binday
```

Claude `agent-*.jsonl` auxiliary logs are skipped by default. Include them only when needed:

```bash
research me transcripts index --project binday --includeAuxiliary
```

## What Good Findings Look Like

Good candidates are useful to someone who wants to work better with AI tomorrow, even if they know nothing about the original project.

Examples of good findings:

- Tell AI examples are illustrative, not the whole spec, or it may stop exploring.
- Give subjective work concrete acceptance criteria before asking for improvements.
- Say what already works before asking AI to fix one part.
- Force live verification for current product features, prices, rules, or dates.
- Ask AI to state unknowns instead of filling gaps with confident guesses.
- Use explicit "do not mention" lists when asking AI to write public-facing copy.
- Make AI inspect the actual screen, file, or data before rewriting generic output.
- Give AI both the desired tone and the anti-tone to avoid.
- Make AI search and read exact prior examples before redoing research.
- Stop the AI as soon as it drifts and restate the rule it missed.
- Push back when AI gives project-specific output after you asked for broad lessons.
- Remind AI of standing rules before letting it continue with code or analysis.

Weak findings are rejected or should be ignored during review:

- Product-specific implementation notes.
- Architecture choices that only matter in this repo.
- Generic advice like "write tests" or "review output".
- Summaries of a chat without a reusable behaviour change.
- Anything that requires private context to understand.

The best findings are usually intervention moments: the exact instruction, constraint, verification loop, anti-example, pushback, reminder, or correction pattern that changed the AI's behaviour. Prefer findings that can say what the AI was about to do wrong, how the human steered it, and what reusable prompt move follows from that.

Good findings can be technical, but they should be explainable to smart beginners. For example, replace "prompt for idempotence" with "ask AI to make expensive work restartable so failed runs do not waste completed work." Repeated UI, performance, debugging, and workflow findings can later become reusable agent skills.

Do not flatten strong findings into vague slogans. Reject headings like "Give agents a finish line." Use direct instructions such as "Ask AI to implement one task, run checks, commit, and continue." The title should carry the actual prompt move.

Avoid developer shorthand in titles. "Infra config" should become "settings." "API" should become "outside service" unless the reader truly needs the technical term. The finding can keep technical detail in the example prompt or explanation.

## Search And Semantic Retrieval Direction

The extraction pipeline should eventually have two retrieval layers:

- exact history search/read: locate sessions, scan parts, and read the few messages that matter
- semantic search over cleaned transcript parts: find conceptually similar prompting moments across agents and projects

A QMD-style local index is a good fit for the second layer. The current bridge is:

```bash
research me transcripts export-corpus --output /tmp/research-transcript-corpus --project tidechecker --limit 100
```

That writes one markdown file per cleaned chunk with JSON provenance. A semantic engine can index those files, then feed exact chunk ids/session ids back into `search`, `show`, `read`, or targeted `audit`.

Do not replace exact transcript provenance with summaries. Semantic search should help find candidates; final findings still need evidence-backed source parts.

Reviewed examples for prompt tuning live in `packages/core/src/transcripts/eval-fixtures.ts`. They are privacy-safe summaries, not raw transcript excerpts, and should be used to keep future extraction focused on real intervention moments rather than project-specific notes.

## Findings Review

Audits are model output. Review findings before promotion:

```bash
research findings review --status unreviewed --markdown --limit 20
research findings approve --id <finding-id> --notes "Strong reusable prompt."
research findings reject --id <finding-id> --notes "Too project-specific."
research findings needs-work --id <finding-id>
```

Review status is stored in finding metadata, so it does not require a schema migration.

## Candidate Export

Promoted candidates are designed for draft agents. Markdown exports include:

- summary
- why it matters
- better move
- mistake to avoid
- example prompt
- reusable rule
- paraphrased evidence
- alpha type and score
- support count when multiple similar findings were merged

```bash
research candidates list --json
research candidates export --format markdown
research candidates export --format json --limit 10
```

Useful promotion controls:

```bash
research candidates promote --minConfidence 0.75
research candidates promote --maxPerAlphaType 3
research candidates promote --force
```

## Local Data And Privacy

This is local-first. Raw transcript files, browser history, local cache databases, and logs should stay on the machine.

The CLI stores its own local state in OS-specific app paths. Inspect them with:

```bash
research privacy
```

Clear local research state with:

```bash
research reset --yes
```

Clear transcript audit findings/candidates and reset chunks with:

```bash
research me transcripts reset-audit --yes
```

## MCP

The MCP package exposes safe research tools for agents.

```bash
research mcp serve
```

Keep MCP tools thin. Reusable behaviour belongs in `packages/core`; MCP and CLI should both call into that.

## Agent Skill

This repo includes a repo-local Codex skill:

- `skills/research`: teaches agents how to collect signals, audit transcripts, promote findings, and export candidate feeds.

Use it when an agent needs to operate this CLI without reading the whole repo.

## Repo Map

- `packages/core`: schemas, SQLite storage, collectors, transcript discovery/parsing/redaction/audit, candidate promotion/export.
- `packages/cli`: `research` command, argument parsing, terminal output.
- `packages/mcp`: MCP stdio server exposing core tools.
- `skills`: repo-local agent skills for using `research`.
- `plans`: product and implementation plans.

Important files:

- `packages/core/src/collectors/app-usage.ts`: Screen Time collector.
- `packages/core/src/collectors/chrome-history.ts`: Chrome history collector.
- `packages/core/src/transcripts/discovery.ts`: transcript file discovery and project targeting.
- `packages/core/src/transcripts/parser.ts`: Claude/Codex transcript parsing.
- `packages/core/src/transcripts/chunking.ts`: redacted chunk creation.
- `packages/core/src/transcripts/audit.ts`: audit prompt and model-command adapter.
- `packages/core/src/transcripts/search.ts`: exact transcript chunk search/read helpers.
- `packages/core/src/transcripts/corpus.ts`: semantic-ready markdown corpus export.
- `packages/core/src/transcripts/review.ts`: finding review queue helpers.
- `packages/core/src/candidates.ts`: finding promotion, dedupe, candidate export.
- `packages/core/src/storage/database.ts`: SQLite schema and storage helpers.
- `packages/cli/src/commands/me.ts`: personal collector and transcript CLI.
- `packages/cli/src/commands/findings.ts`: finding review CLI.
- `packages/cli/src/commands/candidates.ts`: candidate promotion/list/export CLI.

## Development

Run from the repo root:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

Useful smoke checks:

```bash
node packages/cli/dist/index.js --help
node packages/cli/dist/index.js doctor
node packages/cli/dist/index.js privacy
node packages/cli/dist/index.js me transcripts --help
node packages/cli/dist/index.js findings --help
node packages/cli/dist/index.js candidates --help
```

Use Biome for formatting:

```bash
pnpm lint:fix
```
