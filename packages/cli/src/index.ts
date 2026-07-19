import { storymineVersion } from '@research/core'
import { defineCommand, runMain } from 'citty'
import { candidatesCommand } from './commands/candidates.js'
import { findingsCommand } from './commands/findings.js'
import { ideasCommand } from './commands/ideas.js'
import { mcpCommand } from './commands/mcp.js'
import { meCommand } from './commands/me.js'
import { scanCommand } from './commands/scan.js'
import { skillCommand } from './commands/skill.js'
import {
  doctorCommand,
  privacyCommand,
  resetCommand,
} from './commands/system.js'
import { workCommand } from './commands/work.js'

const main = defineCommand({
  meta: {
    name: 'storymine',
    version: storymineVersion,
    description: 'Find blog ideas in your local AI coding chats',
  },
  subCommands: {
    scan: scanCommand,
    work: workCommand,
    ideas: ideasCommand,
    doctor: doctorCommand,
    privacy: privacyCommand,
    skill: skillCommand,
    mcp: mcpCommand,
    // Power tools kept for existing users and deeper debugging. The default
    // help stays focused on scan and ideas.
    candidates: candidatesCommand,
    findings: findingsCommand,
    me: meCommand,
    reset: resetCommand,
  },
})

const argv = process.argv.slice(2)
if (
  argv.length === 0 ||
  (argv.length === 1 && ['help', '--help', '-h'].includes(argv[0] ?? ''))
) {
  printHelp(false)
  process.exit(0)
}
if (argv[0] === 'help' && argv[1] === 'all') {
  printHelp(true)
  process.exit(0)
}
if (argv[0] === 'help' && argv.length > 1) {
  process.argv = [
    process.argv[0] ?? 'node',
    process.argv[1] ?? 'storymine',
    ...argv.slice(1),
    '--help',
  ]
}

await runMain(main)

function printHelp(includePowerTools: boolean): void {
  process.stdout.write(
    [
      `storymine v${storymineVersion}`,
      'Find useful blog ideas in your recent Claude and Codex chats.',
      '',
      'Start here',
      '  storymine scan                 Scan the last 7 days',
      '  storymine scan --project seo   Scan one project',
      '  storymine work                 List recent tools and links',
      '  storymine ideas                Read new story ideas',
      '  storymine ideas approve <id>   Keep a useful idea',
      '  storymine ideas reject <id>    Reject a weak idea',
      '',
      'Local data',
      '  storymine doctor               Check chat sources and storage',
      '  storymine privacy              Show what stays on this machine',
      '  storymine skill install        Install the agent skill',
      '  storymine mcp serve            Run the local MCP server',
      ...(includePowerTools
        ? [
            '',
            'Power tools',
            '  storymine me --help          Collect and inspect source data',
            '  storymine findings --help    Review raw model findings',
            '  storymine candidates --help  Use the old candidate pipeline',
            '  storymine reset --help       Delete local Storymine data',
          ]
        : []),
      '',
      'Use `storymine help all` for power tools.',
      'Use `storymine help <command>` for command help.',
      '',
    ].join('\n'),
  )
}
