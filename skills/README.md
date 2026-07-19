# Agent skills

These skills teach an agent how to use Storymine without reading the whole repo.

They work best when the local CLI has been built and linked:

```bash
pnpm build
storymine --help
```

They can also call the built source entry directly:

```bash
node packages/cli/dist/index.js --help
```

## Included skills

- `storymine`: scan Claude and Codex coding chats, review concrete blog ideas, and inspect local privacy settings.
