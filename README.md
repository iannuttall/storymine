# research

Local-first research collection CLI and MCP server for turning personal work signals into newsletter-ready ideas.

`research` looks at local signals such as app usage, Chrome history, and AI coding transcripts. It filters private/noisy material, extracts reusable lessons, promotes the strongest findings into candidates, and exports structured markdown or JSON that another agent can use.

The main goal right now is not "summarize what happened in a project". The goal is to find useful, general AI-working alpha: prompt patterns, verification loops, course corrections, agent failure modes, and workflow habits that help people get better output from AI.

## What It Does

- Collects Screen Time app usage signals from the local Mac.
- Collects Chrome history signals while filtering localhosts, dashboards, inboxes, and other noise.
- Indexes Claude and Codex transcript files incrementally.
- Parses transcripts into focused user/assistant chunks, excluding system prompts, duplicated event messages, and chain-of-thought noise.
- Redacts obvious secrets before audit prompts leave the machine.
- Audits transcript chunks with a local model command such as `claude -p`.
- Extracts evidence-backed AI usage findings.
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
research me transcripts audit --command "claude -p" --limit 5 --timeoutSeconds 180
research candidates promote --minConfidence 0.7 --limit 25
research candidates export --format markdown --limit 25
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

Weak findings are rejected or should be ignored during review:

- Product-specific implementation notes.
- Architecture choices that only matter in this repo.
- Generic advice like "write tests" or "review output".
- Summaries of a chat without a reusable behaviour change.
- Anything that requires private context to understand.

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
- `packages/core/src/candidates.ts`: finding promotion, dedupe, candidate export.
- `packages/core/src/storage/database.ts`: SQLite schema and storage helpers.
- `packages/cli/src/commands/me.ts`: personal collector and transcript CLI.
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
node packages/cli/dist/index.js candidates --help
```

Use Biome for formatting:

```bash
pnpm lint:fix
```
