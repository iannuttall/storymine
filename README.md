# research

Local-first research collection CLI and MCP server for newsletter and product-building signals.

The product has three layers:

1. Collect personal and public source signals.
2. Promote useful signals into newsletter-shaped candidates.
3. Expose safe, structured outputs for humans, scripts, and agents.

## Packages

- `packages/core`: reusable logic, schemas, storage, collectors, transcript pipeline.
- `packages/cli`: `research` command.
- `packages/mcp`: MCP stdio server.

## Planned Commands

```bash
research me apps --days 7
research me history --days 7
research me transcripts index --since 14d
research me transcripts audit --limit 20
research candidates list --json
research candidates export --format markdown
research mcp serve
research privacy
research doctor
research reset --yes
```

## Install

```bash
pnpm install
pnpm build
```

## Local Data

The CLI stores local config, cache, and audit state using OS-specific app paths. It should never write raw transcript or browser-history exports into this repo.

Use `research privacy` to inspect local storage paths. Use `research reset --yes` to remove the CLI's local config, cache, logs, and SQLite database.

## Transcript Flow

```bash
research me transcripts index --sinceDays 14
research me transcripts parse --limit 20
research me transcripts audit --command "claude -p" --limit 5
research candidates promote
research candidates export --format markdown
```

The audit step passes redacted chunks to the configured model command over stdin and expects JSON findings back.
