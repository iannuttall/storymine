#!/usr/bin/env node
import { researchCoreVersion } from '@research/core'
import { defineCommand, runMain } from 'citty'
import { meCommand } from './commands/me.js'

const main = defineCommand({
  meta: {
    name: 'research',
    version: researchCoreVersion,
    description: 'Local-first research collection CLI',
  },
  subCommands: {
    me: meCommand,
  },
  run: () => {
    process.stdout.write(
      'Use `research --help` for commands. Collectors are still being implemented.\n',
    )
  },
})

await runMain(main)
