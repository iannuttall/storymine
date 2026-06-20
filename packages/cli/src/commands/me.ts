import {
  auditPendingTranscriptChunks,
  collectAndStoreAppUsage,
  collectAndStoreChromeHistory,
  createCommandAuditModel,
  indexTranscriptFiles,
  processTranscriptFiles,
  resetTranscriptAuditData,
} from '@research/core'
import { defineCommand } from 'citty'
import { jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson, printTable } from '../utils.js'

export const meCommand = defineCommand({
  meta: {
    name: 'me',
    description: 'Collect personal local research signals',
  },
  subCommands: {
    apps: defineCommand({
      meta: {
        name: 'apps',
        description: 'Collect Screen Time app usage signals',
      },
      args: {
        days: {
          type: 'string',
          default: '7',
          description: 'Number of days to inspect, 1-30',
        },
        limit: {
          type: 'string',
          default: '30',
          description: 'Maximum apps to return',
        },
        db: {
          type: 'string',
          description: 'Override Screen Time database path',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const dbPath = stringArg(args.db)
        const result = collectAndStoreAppUsage({
          days: numberArg(args.days, 7, { min: 1, max: 30 }),
          limit: numberArg(args.limit, 30, { min: 1, max: 200 }),
          ...(dbPath ? { dbPath } : {}),
        })
        if (jsonFlag(args)) {
          printJson(result)
          return
        }
        printTable(
          ['App', 'Hours', 'Weight'],
          result.signals.map((signal) => [
            signal.title,
            String(signal.metadata.hours ?? ''),
            signal.weight.toFixed(2),
          ]),
        )
      },
    }),
    history: defineCommand({
      meta: {
        name: 'history',
        description: 'Collect Chrome browsing history signals',
      },
      args: {
        days: {
          type: 'string',
          default: '7',
          description: 'Number of days to inspect, 1-365',
        },
        limit: {
          type: 'string',
          default: '40',
          description: 'Maximum URLs to return',
        },
        db: {
          type: 'string',
          description: 'Override Chrome History database path',
        },
        includeNoise: {
          type: 'boolean',
          default: false,
          description: 'Include local, dashboard, and inbox URLs',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const historyPath = stringArg(args.db)
        const result = collectAndStoreChromeHistory({
          days: numberArg(args.days, 7, { min: 1, max: 365 }),
          limit: numberArg(args.limit, 40, { min: 1, max: 500 }),
          includeNoise: Boolean(args.includeNoise),
          ...(historyPath ? { historyPath } : {}),
        })
        if (jsonFlag(args)) {
          printJson(result)
          return
        }
        printTable(
          ['Title', 'Host', 'Visits'],
          result.signals.map((signal) => [
            signal.title,
            String(signal.metadata.host ?? ''),
            String(signal.metadata.visitCount ?? ''),
          ]),
        )
      },
    }),
    transcripts: defineCommand({
      meta: {
        name: 'transcripts',
        description: 'Index and audit local AI transcript files',
      },
      subCommands: {
        index: defineCommand({
          meta: {
            name: 'index',
            description: 'Discover Claude and Codex transcript files',
          },
          args: {
            provider: {
              type: 'string',
              default: 'all',
              description: 'Provider to index: all, claude, or codex',
            },
            sinceDays: {
              type: 'string',
              description: 'Only include files modified in the last N days',
            },
            limit: {
              type: 'string',
              default: '10000',
              description: 'Maximum files to index',
            },
            claudeRoot: {
              type: 'string',
              description: 'Override Claude config root',
            },
            codexRoot: {
              type: 'string',
              description: 'Override Codex config root',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: ({ args }) => {
            const sinceDays =
              args.sinceDays === undefined
                ? undefined
                : numberArg(args.sinceDays, 0, { min: 1, max: 3650 })
            const since = sinceDays
              ? new Date(Date.now() - sinceDays * 86400 * 1000)
              : undefined
            const claudeRoot = stringArg(args.claudeRoot)
            const codexRoot = stringArg(args.codexRoot)
            const result = indexTranscriptFiles({
              providers: providersArg(String(args.provider ?? 'all')),
              limit: numberArg(args.limit, 10_000, { min: 1, max: 100_000 }),
              ...(since ? { since } : {}),
              ...(claudeRoot ? { claudeRoot } : {}),
              ...(codexRoot ? { codexRoot } : {}),
            })
            if (jsonFlag(args)) {
              printJson(result)
              return
            }
            printTable(
              ['Provider', 'Files', 'Bytes'],
              transcriptIndexRows(result.files),
            )
          },
        }),
        parse: defineCommand({
          meta: {
            name: 'parse',
            description: 'Parse indexed transcript files into redacted chunks',
          },
          args: {
            provider: {
              type: 'string',
              default: 'all',
              description: 'Provider to parse: all, claude, or codex',
            },
            limit: {
              type: 'string',
              default: '20',
              description: 'Maximum pending files to parse',
            },
            maxTokens: {
              type: 'string',
              default: '3500',
              description: 'Approximate maximum tokens per chunk',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
            force: {
              type: 'boolean',
              default: false,
              description: 'Reparse already indexed files',
            },
          },
          run: ({ args }) => {
            const providers = providersArg(String(args.provider ?? 'all'))
            const result = processTranscriptFiles({
              limit: numberArg(args.limit, 20, { min: 1, max: 1000 }),
              maxTokens: numberArg(args.maxTokens, 3500, {
                min: 200,
                max: 12_000,
              }),
              ...(providers.length === 1 ? { provider: providers[0] } : {}),
              force: Boolean(args.force),
            })
            if (jsonFlag(args)) {
              printJson(result)
              return
            }
            printTable(
              ['Files', 'Sessions', 'Chunks'],
              [
                [
                  String(result.filesProcessed),
                  String(result.sessions),
                  String(result.chunks),
                ],
              ],
            )
          },
        }),
        audit: defineCommand({
          meta: {
            name: 'audit',
            description: 'Audit pending redacted transcript chunks',
          },
          args: {
            command: {
              type: 'string',
              description: 'Model command that reads prompt from stdin',
            },
            limit: {
              type: 'string',
              default: '10',
              description: 'Maximum pending chunks to audit',
            },
            timeoutSeconds: {
              type: 'string',
              default: '120',
              description: 'Per-chunk model timeout in seconds',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: async ({ args }) => {
            const command = stringArg(args.command)
            if (!command) {
              throw new Error(
                'Pass --command, for example: --command "claude -p"',
              )
            }
            const result = await auditPendingTranscriptChunks({
              limit: numberArg(args.limit, 10, { min: 1, max: 100 }),
              model: createCommandAuditModel(command, {
                timeoutMs:
                  numberArg(args.timeoutSeconds, 120, {
                    min: 5,
                    max: 1800,
                  }) * 1000,
              }),
            })
            if (jsonFlag(args)) {
              printJson(result)
              return
            }
            printTable(
              ['Chunks', 'Failed', 'Findings'],
              [
                [
                  String(result.chunksAudited),
                  String(result.chunksFailed),
                  String(result.findings),
                ],
              ],
            )
          },
        }),
        'reset-audit': defineCommand({
          meta: {
            name: 'reset-audit',
            description:
              'Clear transcript findings/candidates and reset chunks to pending',
          },
          args: {
            yes: {
              type: 'boolean',
              default: false,
              description: 'Confirm deletion without prompting',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: ({ args }) => {
            if (!args.yes) {
              throw new Error(
                'Refusing to reset transcript audit without --yes',
              )
            }
            const result = resetTranscriptAuditData()
            if (jsonFlag(args)) {
              printJson(result)
              return
            }
            printTable(
              ['Candidates', 'Findings', 'Chunks reset'],
              [
                [
                  String(result.candidatesDeleted),
                  String(result.findingsDeleted),
                  String(result.chunksReset),
                ],
              ],
            )
          },
        }),
      },
    }),
  },
})

function providersArg(value: string): Array<'claude' | 'codex'> {
  if (value === 'claude') return ['claude']
  if (value === 'codex') return ['codex']
  return ['claude', 'codex']
}

function transcriptIndexRows(
  files: Array<{ provider: string; sizeBytes: number }>,
): string[][] {
  const rows = new Map<string, { count: number; bytes: number }>()
  for (const file of files) {
    const current = rows.get(file.provider) ?? { count: 0, bytes: 0 }
    current.count += 1
    current.bytes += file.sizeBytes
    rows.set(file.provider, current)
  }
  return [...rows.entries()].map(([provider, row]) => [
    provider,
    String(row.count),
    String(row.bytes),
  ])
}
