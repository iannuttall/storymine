# Implementation Plan

## Goal

Build a local-first research CLI and MCP server that collects personal usage signals, indexes AI-agent transcripts, extracts useful product-building lessons, and emits high-quality structured outputs for humans and agents.

## Architecture

Use one TypeScript monorepo:

- `@research/core`: schemas, storage, collectors, transcript indexing, audit pipeline, promotion, exports.
- `@research/cli`: human and script command surface.
- `@research/mcp`: MCP stdio server exposing safe core tools.

The core rule is `signals -> findings -> candidates`.

- Signals are observed facts from Screen Time, Chrome, transcripts, GitHub, or other sources.
- Findings are interpreted learnings, mainly from transcript audits.
- Candidates are newsletter-shaped items that can be drafted or exported.

## Data Model

Core entities:

- `SourceRun`: one collector or audit run.
- `Signal`: normalized observed input with provenance and privacy level.
- `TranscriptFile`: durable file checkpoint with size, mtime, hash, and indexed status.
- `TranscriptSession`: session metadata independent of provider file shape.
- `TranscriptChunk`: bounded text unit for audit, with redaction status and token estimate.
- `TranscriptFinding`: structured lesson extracted from a chunk or session.
- `Candidate`: newsletter-shaped promoted item.

## Security And Privacy

- Store local state outside the repo with `env-paths`.
- Keep config/cache directories `0700`.
- Copy locked browser databases to temp files before reading.
- Redact secrets before any model call.
- Never export raw private transcript text by default.
- Include provenance pointers, not private blobs, in agent-facing output.
- Support `privacy`, `doctor`, and `reset` commands.

## Performance

- Stream transcript JSONL files line by line.
- Track file checkpoints and content hashes.
- Use SQLite WAL mode and prepared statements.
- Chunk large sessions by token estimate and message boundaries.
- Audit incrementally with limits and resumable status.

## Testing

- Unit test schemas, filters, redaction, chunking, and provider parsers.
- Use temp SQLite databases in tests.
- Use fixture JSONL for Claude and Codex formats.
- Smoke test CLI help and JSON commands.
- Keep MCP tools thin enough to test through core functions.

## Incremental Build

1. Create the workspace and plan.
2. Add schemas, paths, and SQLite migrations.
3. Add Screen Time app usage collector.
4. Add Chrome history collector and noise filters.
5. Add transcript discovery and indexing.
6. Add provider parsers, redaction, and chunking.
7. Add transcript audit runner with pluggable model providers.
8. Add candidate promotion and exports.
9. Add MCP server and safe tools.
10. Add privacy, doctor, reset, docs, and final hardening.

Commit after each completed item.

