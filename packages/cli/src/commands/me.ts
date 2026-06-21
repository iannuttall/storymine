import {
  auditPendingTranscriptChunks,
  collectAndStoreAppUsage,
  collectAndStoreChromeHistory,
  createCommandAuditModel,
  getTranscriptChunkView,
  indexTranscriptFiles,
  processTranscriptFiles,
  readTranscriptChunks,
  renderTranscriptChunkMarkdown,
  resetTranscriptAuditData,
  searchTranscriptChunks,
  type TranscriptChunkView,
  writeTranscriptSearchCorpus,
} from '@research/core'
import { defineCommand } from 'citty'
import { jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson, printTable } from '../utils.js'

const DEFAULT_AUDIT_COMMAND = 'codex exec --ephemeral -'

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
            project: {
              type: 'string',
              description:
                'Only index transcript files matching project path/cwd/title text, comma-separated',
            },
            includeAuxiliary: {
              type: 'boolean',
              default: false,
              description: 'Include auxiliary Claude agent transcript files',
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
            const projectIncludes = commaListArg(args.project)
            const result = indexTranscriptFiles({
              providers: providersArg(String(args.provider ?? 'all')),
              limit: numberArg(args.limit, 10_000, { min: 1, max: 100_000 }),
              ...(since ? { since } : {}),
              ...(claudeRoot ? { claudeRoot } : {}),
              ...(codexRoot ? { codexRoot } : {}),
              ...(projectIncludes.length > 0 ? { projectIncludes } : {}),
              includeAuxiliary: Boolean(args.includeAuxiliary),
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
              default: DEFAULT_AUDIT_COMMAND,
              description:
                'Model command that reads prompt from stdin. Defaults to ephemeral Codex exec',
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
            progress: {
              type: 'boolean',
              default: false,
              description: 'Print per-chunk audit progress to stderr',
            },
          },
          run: async ({ args }) => {
            const command = stringArg(args.command) ?? DEFAULT_AUDIT_COMMAND
            const shouldProgress = Boolean(args.progress) || !jsonFlag(args)
            const result = await auditPendingTranscriptChunks({
              limit: numberArg(args.limit, 10, { min: 1, max: 100 }),
              model: createCommandAuditModel(command, {
                timeoutMs:
                  numberArg(args.timeoutSeconds, 120, {
                    min: 5,
                    max: 1800,
                  }) * 1000,
              }),
              ...(shouldProgress
                ? {
                    onProgress: (event) => {
                      if (event.status === 'started') {
                        process.stderr.write(
                          `Auditing chunk ${event.index}/${event.total} (${event.sessionId} #${event.sequence})\n`,
                        )
                        return
                      }
                      if (event.status === 'audited') {
                        process.stderr.write(
                          `Audited chunk ${event.index}/${event.total}: ${event.findings ?? 0} findings\n`,
                        )
                        return
                      }
                      process.stderr.write(
                        `Failed chunk ${event.index}/${event.total} (${event.sessionId} #${event.sequence})\n`,
                      )
                    },
                  }
                : {}),
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
        search: defineCommand({
          meta: {
            name: 'search',
            description: 'Search parsed transcript chunks with provenance',
          },
          args: {
            query: {
              type: 'string',
              description: 'Search query. Terms must all match somewhere.',
            },
            provider: {
              type: 'string',
              default: 'all',
              description: 'Provider to search: all, claude, or codex',
            },
            project: {
              type: 'string',
              description: 'Only search sessions whose title/cwd/path matches',
            },
            status: {
              type: 'string',
              description: 'Chunk audit status: pending, audited, or failed',
            },
            limit: {
              type: 'string',
              default: '20',
              description: 'Maximum chunks to return',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: ({ args }) => {
            const provider = transcriptProviderArg(args.provider)
            const query = stringArg(args.query)
            const project = stringArg(args.project)
            const status = transcriptStatusArg(args.status)
            const result = searchTranscriptChunks({
              ...(query ? { query } : {}),
              ...(provider ? { provider } : {}),
              ...(project ? { project } : {}),
              ...(status ? { status } : {}),
              limit: numberArg(args.limit, 20, { min: 1, max: 200 }),
            })
            if (jsonFlag(args)) {
              printJson(result)
              return
            }
            printTable(
              ['Chunk', 'Provider', 'Session', 'Excerpt'],
              chunkRows(result.hits),
            )
          },
        }),
        show: defineCommand({
          meta: {
            name: 'show',
            description: 'Show one parsed transcript chunk as markdown',
          },
          args: {
            chunk: {
              type: 'string',
              description: 'Transcript chunk id',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: ({ args }) => {
            const id = stringArg(args.chunk)
            if (!id) throw new Error('Pass --chunk <id>')
            const chunk = getTranscriptChunkView(id)
            if (!chunk) throw new Error(`Transcript chunk not found: ${id}`)
            if (jsonFlag(args)) {
              printJson({ chunk })
              return
            }
            process.stdout.write(renderTranscriptChunkMarkdown(chunk))
          },
        }),
        read: defineCommand({
          meta: {
            name: 'read',
            description: 'Read chunk context from one transcript session',
          },
          args: {
            session: {
              type: 'string',
              description: 'Transcript session id',
            },
            sequence: {
              type: 'string',
              description: 'Center sequence number to read around',
            },
            before: {
              type: 'string',
              default: '1',
              description: 'Chunks before the sequence to include',
            },
            after: {
              type: 'string',
              default: '1',
              description: 'Chunks after the sequence to include',
            },
            limit: {
              type: 'string',
              default: '20',
              description: 'Maximum chunks when no sequence is provided',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: ({ args }) => {
            const sessionId = stringArg(args.session)
            if (!sessionId) throw new Error('Pass --session <id>')
            const chunks = readTranscriptChunks({
              sessionId,
              ...(stringArg(args.sequence)
                ? {
                    sequence: numberArg(args.sequence, 0, {
                      min: 0,
                      max: 1_000_000,
                    }),
                  }
                : {}),
              before: numberArg(args.before, 1, { min: 0, max: 20 }),
              after: numberArg(args.after, 1, { min: 0, max: 20 }),
              limit: numberArg(args.limit, 20, { min: 1, max: 100 }),
            })
            if (jsonFlag(args)) {
              printJson({ chunks })
              return
            }
            process.stdout.write(renderTranscriptChunksMarkdown(chunks))
          },
        }),
        'export-corpus': defineCommand({
          meta: {
            name: 'export-corpus',
            description:
              'Write semantic-ready markdown files for parsed transcript chunks',
          },
          args: {
            output: {
              type: 'string',
              description: 'Output directory for markdown corpus files',
            },
            query: {
              type: 'string',
              description: 'Optional search query to filter exported chunks',
            },
            provider: {
              type: 'string',
              default: 'all',
              description: 'Provider to export: all, claude, or codex',
            },
            project: {
              type: 'string',
              description: 'Only export sessions whose title/cwd/path matches',
            },
            status: {
              type: 'string',
              description: 'Chunk audit status: pending, audited, or failed',
            },
            limit: {
              type: 'string',
              default: '100',
              description: 'Maximum chunks to export',
            },
            json: {
              type: 'boolean',
              default: false,
              description: 'Print structured JSON',
            },
          },
          run: ({ args }) => {
            const outputDir = stringArg(args.output)
            if (!outputDir) throw new Error('Pass --output <dir>')
            const provider = transcriptProviderArg(args.provider)
            const query = stringArg(args.query)
            const project = stringArg(args.project)
            const status = transcriptStatusArg(args.status)
            const result = writeTranscriptSearchCorpus({
              outputDir,
              ...(query ? { query } : {}),
              ...(provider ? { provider } : {}),
              ...(project ? { project } : {}),
              ...(status ? { status } : {}),
              limit: numberArg(args.limit, 100, { min: 1, max: 10_000 }),
            })
            if (jsonFlag(args)) {
              printJson(result)
              return
            }
            printTable(
              ['Output', 'Documents'],
              [[result.outputDir, String(result.documents.length)]],
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

function transcriptProviderArg(value: unknown): 'claude' | 'codex' | undefined {
  const raw = stringArg(value)
  if (raw === 'claude' || raw === 'codex') return raw
  return undefined
}

function transcriptStatusArg(
  value: unknown,
): 'pending' | 'audited' | 'failed' | undefined {
  const raw = stringArg(value)
  if (raw === 'pending' || raw === 'audited' || raw === 'failed') return raw
  return undefined
}

function commaListArg(value: unknown): string[] {
  const raw = stringArg(value)
  if (!raw) return []
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
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

function chunkRows(chunks: TranscriptChunkView[]): string[][] {
  return chunks.map((chunk) => [
    `${chunk.sessionId}#${chunk.sequence}`,
    chunk.provider,
    chunk.sessionTitle ?? chunk.sessionCwd ?? chunk.sessionId,
    chunk.excerpt,
  ])
}

function renderTranscriptChunksMarkdown(chunks: TranscriptChunkView[]): string {
  if (chunks.length === 0) return ''
  return chunks.map((chunk) => renderTranscriptChunkMarkdown(chunk)).join('\n')
}
