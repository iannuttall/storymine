import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  listStoredCandidates,
  promoteTranscriptFindings,
  renderCandidatesMarkdown,
} from '@research/core'
import { z } from 'zod'

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
