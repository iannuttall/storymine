import { runRecentWorkScan, type TranscriptProvider } from '@research/core'
import { defineCommand } from 'citty'
import { commaListArg, jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson, printTable } from '../utils.js'

export const workCommand = defineCommand({
  meta: {
    name: 'work',
    description: 'List recent tools and projects with local evidence',
  },
  args: {
    days: {
      type: 'string',
      default: '7',
      description: 'How many recent days to inspect, 1-365',
    },
    project: {
      type: 'string',
      description: 'Only inspect sessions matching this project or path',
    },
    provider: {
      type: 'string',
      default: 'all',
      description: 'Chat source: all, claude, or codex',
    },
    topics: {
      type: 'string',
      description: 'Personal interests to boost and label, comma-separated',
    },
    json: {
      type: 'boolean',
      default: false,
      description: 'Print structured JSON without progress output',
    },
  },
  run: ({ args }) => {
    const project = stringArg(args.project)
    const provider = providerArg(args.provider)
    const topics = preferredTopics(args.topics)
    const result = runRecentWorkScan({
      days: numberArg(args.days, 7, { min: 1, max: 365 }),
      topics,
      ...(project ? { project } : {}),
      ...(provider ? { provider } : {}),
      ...(!jsonFlag(args)
        ? {
            onProgress: (event: { status: string; message: string }) => {
              process.stderr.write(`${event.message}\n`)
            },
          }
        : {}),
    })

    if (jsonFlag(args)) {
      printJson(result)
      return
    }
    printTable(
      ['Sessions', 'Artifacts', 'Recent work'],
      [
        [
          String(result.transcripts.sessionsFound),
          String(result.artifacts.found),
          String(result.recentWork.length),
        ],
      ],
    )
    process.stdout.write('\n')
    printRecentWork(result.recentWork)
  },
})

export function printRecentWork(
  items: ReturnType<typeof runRecentWorkScan>['recentWork'],
): void {
  if (items.length === 0) {
    process.stdout.write('No recent tools or projects found.\n')
    return
  }
  process.stdout.write('Recent work\n')
  for (const item of items) {
    const details: string[] = [item.workType]
    if (item.topics.length > 0) details.push(item.topics.join(', '))
    process.stdout.write(
      `- ${item.name}: ${details.join('; ')}; score ${item.score.toFixed(2)}\n`,
    )
    if (item.toolSignals.length > 0) {
      process.stdout.write(`  Tool signals: ${item.toolSignals.join(', ')}\n`)
    }
    if (item.publication.repository) {
      process.stdout.write(
        `  Repository: ${item.publication.repository.url} (visibility unknown)\n`,
      )
    }
    for (const url of item.publication.declaredPublicUrls) {
      process.stdout.write(`  Declared public URL: ${url}\n`)
    }
    if (item.publication.package) {
      process.stdout.write(`  Package: ${item.publication.package.name}\n`)
    }
  }
}

function preferredTopics(value: unknown): string[] {
  const explicit = commaListArg(value)
  if (explicit.length > 0) return explicit
  return commaListArg(process.env.STORYMINE_TOPICS)
}

function providerArg(value: unknown): TranscriptProvider | undefined {
  const provider = stringArg(value)
  if (!provider || provider === 'all') return undefined
  if (provider === 'claude' || provider === 'codex') return provider
  throw new Error('--provider must be all, claude, or codex')
}
