---
name: research
description: Use the local research CLI and MCP server to collect personal research signals, audit Claude/Codex transcripts for reusable prompting lessons, promote findings into newsletter candidates, or export candidate markdown/JSON for drafting agents. Trigger when the user asks to run research backfills, inspect app usage or Chrome history signals, audit AI chat transcripts, extract high-agency AI prompting tips, dedupe/promote findings, or use the research candidate feed.
---

# research

Use `research` to turn local personal signals and AI transcript audits into candidate ideas.

The target output is not project summaries. It is hard-won prompting alpha: non-obvious ways to steer AI while building real products every day.

The product is local-first. Treat app usage, browser history, transcript files, cache DBs, and raw audit chunks as private.

## Pick The Interface

1. Use MCP tools for existing candidate work when available:
   - `research_list_candidates`
   - `research_export_candidates`
   - `research_promote_findings`
2. Use the CLI for collection, transcript indexing, parsing, audit, privacy, and reset.
3. In a source checkout, use `node packages/cli/dist/index.js` if the `research` binary is not linked.

## Core Workflow

Run collection commands with explicit limits:

```bash
research me apps --days 7 --limit 30
research me history --days 7 --limit 40
```

Run a targeted transcript audit:

```bash
research me transcripts index --provider claude --project <project> --limit 10
research me transcripts parse --provider claude --limit 10 --maxTokens 2500
research me transcripts audit --limit 5 --timeoutSeconds 180
research candidates promote --minConfidence 0.7 --limit 25
research candidates export --format markdown --limit 25
```

Audit defaults to `codex exec --ephemeral -`. Keep `--ephemeral` so audit runs do not create new Codex transcript sessions that pollute future search. Override when needed:

```bash
research me transcripts audit --command "claude -p" --limit 5
```

Use `--project` to match Claude project folder names, transcript paths, and Codex `cwd/title` metadata:

```bash
research me transcripts index --project binday
research me transcripts index --project tidechecker
research me transcripts index --provider codex --project /Users/iannuttall/workers/binday
```

Claude `agent-*.jsonl` auxiliary logs are skipped by default. Only add `--includeAuxiliary` when the user explicitly wants those.

## Output Quality Bar

Good findings are broad AI-prompting lessons, not project notes.

Prefer findings like:

- Tell AI examples are illustrative, not the whole spec.
- Give subjective work concrete acceptance criteria.
- Say what already works before asking AI to fix one part.
- Force live verification for current facts, prices, rules, or dates.
- Tell AI to admit unknowns instead of guessing.
- Make AI inspect real files, screens, docs, or outputs before rewriting.
- Give AI both the desired tone and the anti-tone to avoid.
- Make AI search and read exact prior examples before redoing research.

Reject or down-rank:

- product-specific architecture choices
- implementation notes that only matter in one repo
- generic advice like "write tests" without a sharper AI-specific move
- summaries of a chat without a reusable behaviour change
- private details or raw transcript quotes

For larger backfills, search/read should come before audit. The desired future shape is exact transcript search plus QMD-style semantic search over cleaned transcript parts, but final findings must still point back to exact evidence.

## Candidate Work

Promote findings before exporting:

```bash
research candidates promote --minConfidence 0.7 --limit 25
research candidates export --format markdown --limit 25
```

Use `--maxPerAlphaType` to keep exports varied:

```bash
research candidates promote --maxPerAlphaType 3
```

When using MCP, prefer:

- `research_promote_findings` before export if new audits have run.
- `research_export_candidates` when a draft agent needs markdown input.
- `research_list_candidates` when another tool wants structured JSON.

## Privacy Rules

- Do not paste raw transcript chunks into the user-facing answer.
- Evidence should be short paraphrases.
- Do not commit local DBs, logs, browser history copies, raw transcript exports, tokens, or secrets.
- Use `research privacy` to inspect local paths.
- Use `research reset --yes` only when the user explicitly wants local research state deleted.
- Use `research me transcripts reset-audit --yes` only when the user explicitly wants transcript findings/candidates cleared.

## Useful Checks

```bash
research doctor
research privacy
research candidates list --json
research candidates export --format markdown
```

For source development:

```bash
pnpm build
pnpm lint
pnpm test
```
