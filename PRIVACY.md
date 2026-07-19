# Privacy

Storymine reads Claude and Codex session files from your machine. It stores its index, redacted transcript chunks, summaries, and story ideas in a local SQLite database.

Raw transcript files are never copied into the package or an export. Storymine removes common secrets, email addresses, and usernames from home directory paths before it stores transcript chunks.

Storymine inspects only project directories referenced by the selected chats during the main scan. It reads local Git history, package metadata, repository remotes, and configured site URLs. It does not contact those URLs to check whether they are public or reachable.

The story scan uses a model command such as `codex exec --ephemeral -` or `claude -p`. Redacted transcript excerpts are passed to that command. The model provider may process those excerpts outside your machine, depending on the command and account you use.

Run `storymine privacy` to see every local storage path. Run `storymine reset --yes` to delete Storymine's local state.
