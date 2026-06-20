# Agent skills

These skills teach an agent how to use `research` without reading the whole repo.

They work best when the local CLI has been built and linked:

```bash
pnpm build
research --help
```

They can also call the built source entry directly:

```bash
node packages/cli/dist/index.js --help
```

## Included skills

- `research`: collect personal signals, audit Claude/Codex transcripts, promote findings, and export newsletter candidate feeds.
