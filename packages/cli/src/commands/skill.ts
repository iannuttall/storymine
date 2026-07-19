import { defineCommand } from 'citty'
import { jsonFlag } from '../args.js'
import { printJson } from '../utils.js'
import { installStorymineSkill } from './skill-install.js'

const installCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install the Storymine skill for coding agents',
  },
  args: {
    json: {
      type: 'boolean',
      default: false,
      description: 'Print structured JSON',
    },
  },
  run: ({ args }) => {
    const json = jsonFlag(args)
    const result = installStorymineSkill({ quiet: json })
    if (json) {
      printJson(result)
      if (result.status === 'failed') process.exitCode = 1
      return
    }
    if (result.status === 'failed') {
      throw new Error(`Skill install failed: ${result.error}`)
    }
    process.stdout.write(
      'Storymine skill installed. Coding agents can discover it now.\n',
    )
  },
})

export const skillCommand = defineCommand({
  meta: {
    name: 'skill',
    description: 'Install the packaged Storymine agent skill',
  },
  subCommands: {
    install: installCommand,
  },
})
