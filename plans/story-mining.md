# Story Mining Redesign

## V1 hardening update (2026-07-19)

This file records the original design and is kept for history. The public v1 surface is now:

```bash
storymine scan [--days N] [--project TEXT] [--provider claude|codex] [--topics CSV] [--ideas N] [--agent codex|claude] [--json]
storymine work [--days N] [--project TEXT] [--provider claude|codex] [--topics CSV] [--json]
storymine ideas [approve|reject|needs-work] [idea-id]
```

The main scan no longer assumes `~/dev` or `~/dev/sandbox`. It indexes selected chats first, gets their working directories, resolves Git roots, and inspects only those projects. Broad root scanning remains an explicit power tool.

Recent-work evidence now includes work type, recent commits, created-file counts, package metadata, repository remotes, and locally configured site URLs. Repository visibility remains `unknown`; a remote is not proof that a repo is public. URLs are not contacted.

User interests come from `--topics` or `STORYMINE_TOPICS`. They are deterministic, bounded ranking hints and labels. With no interests, ranking is topic-neutral.

The quality gate uses privacy-safe strong and weak fixtures, requires at least three of four arc signals (real failure, non-obvious move, actionable recipe, observable proof), rejects routine/generic output, caps one mined idea per project, and keeps failed model output retryable.

Packaging follows the `seo` CLI shape: one public npm package, private workspaces, bundled CLI/core/MCP entry points, curated default help, package-contract tests, and install-from-tarball tests.

## Original diagnosis and design

Why: the audit pipeline produced meta-prompting platitudes and missed the
two best stories of the week (the png-to-svg reconstruction skill in
`~/dev/sandbox/png-to-svg`, and repeated GPT-5.6 overengineering
observations in the `~/dev/cli/seo` chats). Diagnosis from 2026-07-11:

1. Coverage is a trickle. 2,098 transcript files indexed, ~175 sessions
   parsed, 24 chunks EVER audited (1,264 pending). Audit costs one
   `codex exec` per chunk and selection is recency-first, so the most
   recent session eats the whole budget.
2. The audit prompt optimizes for prompting lessons (alpha types like
   verification-loop / scope-control). Abstract advice is its designed
   output. "Built a novel tool that solved a real problem" has no finding
   type, so the best material scores zero.

## New pipeline (deterministic-first, cheap-first)

### Stage 0 — artifact scan (no LLM, complete)

Scan work products directly instead of inferring them from words:

- git activity across `~/dev/**` for the window (repos with commits, new
  repos, new `SKILL.md`/`skills/*` files, new CLIs).
- New sandbox projects (`~/dev/sandbox/*` with recent mtimes).
- Each artifact becomes a signal with provenance. png2svg is found by
  this stage in milliseconds, every time.

### Stage 1 — session summaries (one cheap LLM call per session, full coverage)

For every session in the window (not a 15-chunk sample), produce a 5–10
line structured summary: what was being built, problems hit, approaches
that failed, what worked, tools/skills created, repeated complaints or
opinions. Store in a new `session_summaries` table. Idempotent, resumable,
cheap model. This is the searchable layer — full-week coverage at a cost
that scales with sessions, not chunks.

### Stage 2 — story mining (deep, targeted, few)

Rank summaries by story potential: artifact built (Stage 0 crossref),
failure→breakthrough arcs, repeated opinions across sessions (the GPT-5.6
pattern), unusual tool combinations. Deep-audit only the top ~10 sessions
with a REWRITTEN prompt that hunts for:

> concrete problem → standard approaches failed → non-obvious move →
> reusable recipe → evidence it worked

NOT prompting lessons. Kill the current alpha-type taxonomy for this pass
or add a `story` finding type with those five fields.

### Quality gate (the png-to-svg test)

A finding ships only with all five fields concrete. If the tip could be
written without having done the work, reject at promotion time.

### Search (later, only if Stage 1 proves insufficient)

Wishlist item from Ian: embeddings/vector search over transcripts. Do NOT
build until session summaries + SQLite FTS over them demonstrably fail —
summaries shrink the corpus ~100x, and FTS5 over summaries is likely
enough. Revisit after two real weekly runs.

## Notes

- Keep everything resumable: summarize/audit marks progress in the DB so a
  killed run continues where it stopped.
- Keep the 350-line module rule; this is 2–3 new small modules
  (artifact-scan, summarize, story-audit), not extensions of store.ts.
- CLI surface: `research me artifacts --days 7`, `research me summarize
  --days 7`, `research me stories --days 7 --limit 10`.

## Implementation notes (2026-07-11)

Shipped all three stages. Commands (CLI + MCP):

- `research me artifacts --days N [--root DIR] --json` -> `storeArtifactSignals`
  / MCP `research_scan_artifacts`. Deterministic, no model.
- `research me summarize --days N [--project X] [--provider claude|codex]
  [--limit N] [--command "..."] [--force] --json` -> `summarizeSessions` / MCP
  `research_summarize_sessions`. Plus `research me summaries` to list stored rows.
- `research me stories --days N [--limit N] [--provider ...] [--command "..."]
  --json` -> `mineStories` / MCP `research_mine_stories`.

New modules (all under the informal per-module size budget):

- `packages/core/src/artifacts/scan.ts` — bounded DFS over `~/dev` (depth 4,
  skips node_modules/.git/dist/etc, ignores symlinks), one `git log --since`
  per repo (3s timeout, capped at 300 repos, most-recent first), skill-file
  detection (`SKILL.md` + `skills/**/*.md`), and `~/dev/sandbox/*` project
  mtime scan. Emits `Artifact`s and stores them as `source='artifact'` signals.
- `packages/core/src/transcripts/summarize.ts` — one cheap model call per
  session, reads the session's already-redacted chunks (never the raw file, so
  the 354MB codex file is safe), head+tail token budgeting for huge sessions,
  idempotent (skips sessions with an existing summary unless `--force`) and
  resumable (each summary is written before the next session starts).
- `packages/core/src/transcripts/story-ranking.ts` — deterministic ranking
  (artifact crossref, failure->breakthrough, repeated-opinion-across-sessions,
  tools-created), the five-field `validateStoryFields`, and
  `isCompleteStoryFinding` used as the promotion gate.
- `packages/core/src/transcripts/stories.ts` — deep story prompt + orchestration.

Storage: new `session_summaries` table added to `CREATE_SQL` in
`storage/database.ts` (same create-if-not-exists pattern as the rest), plus
`listTranscriptSessionsInWindow`, `listChunksForSession`, and summary CRUD.

Story findings reuse `transcript_findings` with `category='story'` and the five
fields in metadata, so `findings review` / `candidates promote` work unchanged.
The quality gate is enforced twice: `validateStoryFields` at parse time (a story
is never stored unless all five fields are concrete and reference a real
file/tool/command, and generic tells like "verify its work" are rejected), and
`isCompleteStoryFinding` filters story findings again inside
`promoteTranscriptFindings`.

Deviations from the plan:

- `scripts/check-file-lines.mjs` / a hard 350-line lint rule does not exist in
  this repo (several existing files exceed 350 lines). Kept modules small anyway
  by splitting ranking (`story-ranking.ts`) from orchestration (`stories.ts`).
- Ranking must NOT scale with artifact count: a pre-existing repo with dozens of
  recently-touched skill files was initially outscoring a brand-new sandbox
  project. Fixed to score by the strongest matched artifact *kind*
  (`new-repo`/`sandbox-project` > `skill` > `git-repo-active`), flat, not per
  file. png-to-svg now ranks #1.
- FTS5 over summaries: not built (plan marks it optional). ~175 sessions rank
  in-memory fine; revisit after two real weekly runs.

Validation (2026-07-11, `--command "codex exec --ephemeral -"`, tight scopes):

1. `me artifacts --days 14` finds `~/dev/sandbox/png-to-svg` every run (as both
   `sandbox-project` and the `png2svg` skill), ~2s.
2. `me summarize --project png-to-svg` captured the geometry-first
   reconstruction (resvg-py, silhouette IoU, watermark handling, `png2svg` CLI +
   skill). `me summarize --project seo --limit 3` captured the repeated
   local-first / anti-SaaS-backend / "not refactoring just for the sake of it"
   opinions. Note: the verbatim "GPT-5.6 is over the top" phrasing is not in the
   currently-parsed seo chunks (grep confirms only GPTBot/ChatGPT product
   mentions there); the overengineering complaint that IS in the parsed data is
   surfaced. Full "GPT-5.6" coverage needs a wider `parse` + `summarize` pass.
3. `me stories --days 14` ranks png-to-svg #1 (score 12.7) and produced a story
   with all five fields concrete (real files `src/png2svg/measure.py`, metrics
   0.998 silhouette IoU / 0.21px edge distance). Rejected 0 of the audited top.
