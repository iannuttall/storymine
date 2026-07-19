import { spawnSync } from 'node:child_process'
import {
  createCommandAuditModel,
  renderStoryIdeasMarkdown,
  runStoryScan,
  type TranscriptProvider,
} from '@research/core'
import { defineCommand } from 'citty'
import { commaListArg, jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson, printTable } from '../utils.js'
import { printRecentWork } from './work.js'

export const scanCommand = defineCommand({
  meta: {
    name: 'scan',
    description: 'Find strong blog ideas in recent coding chats',
  },
  args: {
    days: {
      type: 'string',
      default: '7',
      description: 'How many recent days to scan, 1-365',
    },
    project: {
      type: 'string',
      description: 'Only scan sessions matching this project or path',
    },
    provider: {
      type: 'string',
      default: 'all',
      description: 'Chat source: all, claude, or codex',
    },
    ideas: {
      type: 'string',
      default: '5',
      description: 'Maximum new story ideas, 1-20',
    },
    topics: {
      type: 'string',
      description: 'Personal interests to boost, comma-separated',
    },
    agent: {
      type: 'string',
      default: 'codex',
      description: 'Local agent command profile: codex or claude',
    },
    json: {
      type: 'boolean',
      default: false,
      description: 'Print structured JSON without progress output',
    },
  },
  run: async ({ args }) => {
    const command = modelCommand(args.agent)
    const provider = providerArg(args.provider)
    const project = stringArg(args.project)
    const topics = preferredTopics(args.topics)
    const result = await runStoryScan({
      model: createCommandAuditModel(command, { timeoutMs: 300_000 }),
      days: numberArg(args.days, 7, { min: 1, max: 365 }),
      ideaLimit: numberArg(args.ideas, 5, { min: 1, max: 20 }),
      topics,
      ...(project ? { project } : {}),
      ...(provider ? { provider } : {}),
      ...(!jsonFlag(args)
        ? {
            onProgress: (event: { status: string; message: string }) => {
              if (event.status !== 'item') {
                process.stderr.write(`${event.message}\n`)
              }
            },
          }
        : {}),
    })

    if (jsonFlag(args)) {
      printJson(result)
      return
    }
    printTable(
      ['Sessions', 'Selected', 'Recent work', 'Ideas'],
      [
        [
          String(result.transcripts.sessionsFound),
          String(result.selectedSessions),
          String(result.recentWork.length),
          String(result.mining.created),
        ],
      ],
    )
    process.stdout.write('\n')
    if (result.recentWork.length > 0) {
      printRecentWork(result.recentWork.slice(0, 8))
      process.stdout.write('\n')
    }
    process.stdout.write(renderStoryIdeasMarkdown(result.ideas))
    if (result.ideas.length > 0) {
      process.stdout.write('\nNext: storymine ideas\n')
    }
  },
})

function modelCommand(value: unknown): string {
  const override =
    process.env.STORYMINE_MODEL_COMMAND ?? process.env.RESEARCH_MODEL_COMMAND
  if (override?.trim()) return override.trim()
  const agent = stringArg(value) ?? 'codex'
  if (agent === 'codex') {
    requireCommand('codex')
    return 'codex exec --ephemeral -'
  }
  if (agent === 'claude') {
    requireCommand('claude')
    return 'claude -p'
  }
  throw new Error('--agent must be codex or claude')
}

function requireCommand(command: string): void {
  const result = spawnSync(command, ['--version'], { timeout: 3000 })
  if (result.status !== 0) {
    throw new Error(
      `${command} is not available. Install it or choose another --agent.`,
    )
  }
}

function providerArg(value: unknown): TranscriptProvider | undefined {
  const provider = stringArg(value)
  if (!provider || provider === 'all') return undefined
  if (provider === 'claude' || provider === 'codex') return provider
  throw new Error('--provider must be all, claude, or codex')
}

function preferredTopics(value: unknown): string[] {
  const explicit = commaListArg(value)
  if (explicit.length > 0) return explicit
  return commaListArg(process.env.STORYMINE_TOPICS)
}
