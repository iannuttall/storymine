---
name: storymine
description: Use the local Storymine CLI to scan Claude and Codex coding chats for concrete blog ideas, review mined ideas, inspect local storage, or return structured idea JSON. Trigger when the user asks to find writing ideas in recent coding work, audit coding chats for publishable stories, review Storymine results, or run a local transcript scan.
---

# Storymine

Storymine finds concrete blog ideas in recent Claude and Codex coding chats.

Start with the main workflow:

```bash
storymine scan
storymine work
storymine ideas
```

Narrow a scan when the user names a project or chat source:

```bash
storymine scan --project seo
storymine scan --provider codex --days 14
storymine scan --topics "marketing,seo,AI coding"
```

Use JSON for agents and scripts:

```bash
storymine scan --json
storymine work --json
storymine ideas --status all --json
```

## What counts as a useful idea

A strong idea includes five things:

- the concrete problem
- approaches that failed
- the move that unlocked progress
- a recipe another person can follow
- evidence that it worked

Reject generic advice, routine edits, project summaries, and anything that only makes sense with the original transcript open.

`--topics` contains the current user's interests. It is a ranking hint, not a filter and not a global default. Use `STORYMINE_TOPICS` when the user wants stable personal preferences.

Recent-work evidence comes from chat working directories, Git history, created files, package metadata, remotes, and configured site URLs. A configured repository URL does not prove public visibility; preserve Storymine's `unknown` label unless another source verifies it.

Use `storymine work` when the user only wants the deterministic inventory and does not need model interpretation.

## Review ideas

Keep human feedback attached to the idea:

```bash
storymine ideas approve <idea-id>
storymine ideas reject <idea-id>
storymine ideas needs-work <idea-id>
```

Approved ideas are eligible for the older candidate export pipeline. New ideas are not promoted automatically.

## Privacy

- Do not paste raw transcript chunks into an answer.
- Keep evidence short and paraphrased.
- Never commit Storymine's database, logs, or transcript exports.
- Redacted excerpts are passed to the configured model command during a scan.
- Use `storymine privacy` to inspect local paths.
- Only run `storymine reset --yes` when the user explicitly asks to delete local state.

## Power tools

Use `storymine help all` to discover the lower-level transcript, finding, and candidate commands. Reach for them when debugging a failed scan or inspecting exact provenance. Normal use should stay on `scan` and `ideas`.
