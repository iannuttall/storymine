import { researchCoreVersion } from '@research/core'
import { defineCommand, runMain } from 'citty'
import { candidatesCommand } from './commands/candidates.js'
import { findingsCommand } from './commands/findings.js'
import { mcpCommand } from './commands/mcp.js'
import { meCommand } from './commands/me.js'
import {
  doctorCommand,
  privacyCommand,
  resetCommand,
} from './commands/system.js'

const main = defineCommand({
  meta: {
    name: 'research',
    version: researchCoreVersion,
    description: 'Local-first research collection CLI',
  },
  subCommands: {
    candidates: candidatesCommand,
    doctor: doctorCommand,
    findings: findingsCommand,
    mcp: mcpCommand,
    me: meCommand,
    privacy: privacyCommand,
    reset: resetCommand,
  },
})

await runMain(main)
