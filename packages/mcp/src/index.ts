import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createCommandAuditModel,
  listStoredCandidates,
  mineStories,
  promoteTranscriptFindings,
  renderCandidatesMarkdown,
  storeArtifactSignals,
  summarizeSessions,
} from '@research/core'
import { z } from 'zod'

// Bulk summarization runs on cheap luna; deep passes get terra at high.
// Never default to the sol model - it rinses tokens.
const DEFAULT_SUMMARIZE_COMMAND =
  'codex exec -m gpt-5.6-luna -c model_reasoning_effort=ultra --ephemeral -'
const DEFAULT_DEEP_COMMAND =
  'codex exec -m gpt-5.6-terra -c model_reasoning_effort=high --ephemeral -'

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'research',
      version: '0.1.0',
    },
    { capabilities: { logging: {} } },
  )

  server.tool(
    'research_list_candidates',
    'List stored research candidates as structured JSON.',
    {
      limit: z.number().int().min(1).max(1000).default(50),
    },
    async ({ limit }) =>
      jsonResult({ candidates: listStoredCandidates({ limit }) }),
  )

  server.tool(
    'research_export_candidates',
    'Export stored research candidates as markdown for draft agents.',
    {
      limit: z.number().int().min(1).max(1000).default(50),
    },
    async ({ limit }) =>
      textResult(renderCandidatesMarkdown(listStoredCandidates({ limit }))),
  )

  server.tool(
    'research_promote_findings',
    'Promote high-confidence transcript findings into candidates.',
    {
      minConfidence: z.number().min(0).max(1).default(0.7),
      limit: z.number().int().min(1).max(500).default(25),
    },
    async ({ minConfidence, limit }) =>
      jsonResult(promoteTranscriptFindings({ minConfidence, limit })),
  )

  server.tool(
    'research_scan_artifacts',
    'Scan local work products (git activity, skills, sandbox projects) as artifact signals. Deterministic, no model calls.',
    {
      days: z.number().int().min(1).max(365).default(7),
    },
    async ({ days }) => jsonResult(storeArtifactSignals({ days })),
  )

  server.tool(
    'research_summarize_sessions',
    'Summarize parsed transcript sessions with one cheap model call each. Idempotent and resumable.',
    {
      days: z.number().int().min(1).max(365).default(7),
      project: z.string().optional(),
      provider: z.enum(['claude', 'codex']).optional(),
      limit: z.number().int().min(1).max(1000).default(50),
      command: z.string().default(DEFAULT_SUMMARIZE_COMMAND),
      concurrency: z.number().int().min(1).max(8).default(4),
      force: z.boolean().default(false),
    },
    async ({ days, project, provider, limit, command, concurrency, force }) =>
      jsonResult(
        await summarizeSessions({
          days,
          limit,
          force,
          concurrency,
          ...(project ? { project } : {}),
          ...(provider ? { provider } : {}),
          model: createCommandAuditModel(command, { timeoutMs: 180_000 }),
        }),
      ),
  )

  server.tool(
    'research_mine_stories',
    'Rank summarized sessions by story potential and deep-audit the top ones into story findings.',
    {
      days: z.number().int().min(1).max(365).default(7),
      limit: z.number().int().min(1).max(50).default(10),
      provider: z.enum(['claude', 'codex']).optional(),
      command: z.string().default(DEFAULT_DEEP_COMMAND),
    },
    async ({ days, limit, provider, command }) =>
      jsonResult(
        await mineStories({
          days,
          limit,
          ...(provider ? { provider } : {}),
          model: createCommandAuditModel(command, { timeoutMs: 240_000 }),
        }),
      ),
  )

  return server
}

export async function startMcpServer(
  options: { test?: boolean } = {},
): Promise<void> {
  if (options.test) {
    process.stdout.write('research MCP server constructed successfully.\n')
    return
  }

  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

function jsonResult(value: unknown): {
  content: Array<{ type: 'text'; text: string }>
} {
  return textResult(JSON.stringify(value, null, 2))
}

function textResult(text: string): {
  content: Array<{ type: 'text'; text: string }>
} {
  return { content: [{ type: 'text', text }] }
}
