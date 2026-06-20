import { researchCoreVersion } from '@research/core'
import { defineCommand, runMain } from 'citty'
import { candidatesCommand } from './commands/candidates.js'
import { mcpCommand } from './commands/mcp.js'
import { meCommand } from './commands/me.js'

const main = defineCommand({
  meta: {
    name: 'research',
    version: researchCoreVersion,
    description: 'Local-first research collection CLI',
  },
  subCommands: {
    candidates: candidatesCommand,
    mcp: mcpCommand,
    me: meCommand,
  },
})

await runMain(main)
