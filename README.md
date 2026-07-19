# Storymine

Storymine reads your recent Claude and Codex coding chats and finds the few ideas that may be worth turning into blog posts.

It looks for work with a real shape: a concrete problem, failed attempts, a useful change of direction, a recipe someone else can follow, and proof that the result worked.

The evidence pass is deterministic. Storymine gets project directories from the selected chats, resolves their Git roots, and inspects recent commits, created files, package metadata, repository remotes, and configured site URLs. It does not assume a particular folder layout.

## Install

```bash
npm install --global storymine
```

Storymine needs Node.js 20 or newer. It also needs either the Codex CLI or Claude Code for the model pass.

## Scan your recent chats

```bash
storymine scan
```

This scans the last seven days. Indexing and redaction happen locally. Storymine ranks sessions before it calls a model, so a busy week does not turn into hundreds of model calls.

Narrow the scan when you already know where the useful work happened:

```bash
storymine scan --project seo
storymine scan --provider codex --days 14
storymine scan --agent claude
```

Personal interests are optional ranking hints, not built-in product opinions:

```bash
storymine scan --topics "marketing,seo,AI coding"
```

Set `STORYMINE_TOPICS` to use the same interests on every scan. With no interests configured, Storymine stays topic-neutral. Interests add a small deterministic boost and never rescue a weak story.

A scan can take several minutes. It is resumable. Sessions with valid stored summaries are skipped on the next run, while failed or invalid summaries are tried again.

## See what you built

Use the deterministic evidence pass without a model:

```bash
storymine work --days 14
storymine work --topics "marketing,seo,AI coding" --json
```

This lists recent tools, projects, created-file and commit counts, command or skill signals, package names, repository remotes, and configured site URLs. It is also included in `storymine scan` output.

## Read and review ideas

```bash
storymine ideas
```

Each idea includes the problem, what failed, the non-obvious move, a reusable recipe, evidence, matched interests, and any locally declared repository, package, or site links. Raw transcript text is not included.

A Git remote proves that a repository URL is configured. It does not prove that the repository is public. Storymine labels its visibility as unknown. Site URLs come from local package or deployment configuration and are not checked over the network.

Keep useful ideas and reject weak ones:

```bash
storymine ideas approve <idea-id>
storymine ideas reject <idea-id>
storymine ideas needs-work <idea-id>
```

That feedback stays in the local database. It gives future prompt and eval work something real to improve against.

Agents and scripts should use JSON:

```bash
storymine scan --json
storymine ideas --status all --json
```

JSON mode does not print progress or terminal decoration.

## What a good result looks like

Weak output sounds like advice anyone could have written without doing the work:

- write tests
- be clear with AI
- use a better library
- review the output

A useful idea names what actually happened. For example, a raster logo kept producing messy traced paths. The useful move was to measure the intended geometry, rebuild the shape from circles and shared slopes, then compare renders with image metrics. The passing metrics and generated asset provide the proof.

Storymine rejects ideas that are too short, generic, routine, missing a failure-to-result arc, or missing measurable evidence. It also limits projects from dominating a run, collapses repeat stories into supporting evidence, and keeps invalid model responses retryable. Human review is still part of the workflow. A model score is not a publishing decision.

## Privacy

Transcript files and Storymine's SQLite database stay on your machine. Stored chunks have common secrets, email addresses, and usernames in home directory paths removed.

The model pass is a separate boundary. Redacted excerpts are sent to the command used by `storymine scan`, which defaults to `codex exec --ephemeral -`. Your model provider may process those excerpts outside your machine.

Inspect local paths and counts with:

```bash
storymine privacy
storymine doctor
```

`storymine doctor` also checks whether the Codex and Claude commands are available and reports their installed versions.

Delete Storymine's local state only when you mean to:

```bash
storymine reset --yes
```

See [PRIVACY.md](PRIVACY.md) for the full boundary.

## Install the agent skill

Storymine ships one small skill that teaches coding agents when to scan, use the deterministic work inventory, and review ideas. Install it through the same skills ecosystem used by the SEO CLI:

```bash
storymine skill install
```

Without a global Storymine install, run:

```bash
npx storymine skill install
```

The installer delegates to `npx skills add iannuttall/storymine`.

## MCP

```bash
storymine mcp serve
```

The MCP server exposes four jobs:

- `storymine_scan`
- `storymine_recent_work`
- `storymine_list_ideas`
- `storymine_review_idea`

The CLI and MCP server call the same functions in `packages/core`.

## Power tools

Normal use should stay on `scan` and `ideas`. The indexing, search, summary, finding, and old candidate commands remain available for debugging and deeper audits.

```bash
storymine help all
storymine me transcripts --help
storymine findings --help
```

## Work on the source

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm test:package-install
```

The monorepo has three private workspaces:

- `packages/core` owns storage, parsing, redaction, ranking, summaries, mining, ideas, and the full scan
- `packages/cli` owns command parsing and terminal output
- `packages/mcp` owns the small stdio server

The root `storymine` package bundles those workspaces into one public API, one CLI binary, and `storymine/mcp`.
