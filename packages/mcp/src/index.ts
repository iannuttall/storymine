import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  createCommandAuditModel,
  listStoryIdeas,
  reviewTranscriptFinding,
  runRecentWorkScan,
  runStoryScan,
  storyIdeaFromFinding,
} from '@research/core'
import { z } from 'zod'

const AGENT_COMMANDS = {
  codex: 'codex exec --ephemeral -',
  claude: 'claude -p',
} as const

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'storymine',
      version: '0.1.0',
    },
    { capabilities: { logging: {} } },
  )

  server.tool(
    'storymine_scan',
    'Scan recent local Claude and Codex chats for concrete blog ideas.',
    {
      days: z.number().int().min(1).max(365).default(7),
      project: z.string().optional(),
      provider: z.enum(['claude', 'codex']).optional(),
      topics: z.array(z.string().min(1)).max(20).optional(),
      ideas: z.number().int().min(1).max(20).default(5),
      agent: z.enum(['codex', 'claude']).default('codex'),
    },
    async ({ days, project, provider, topics, ideas, agent }) =>
      jsonResult(
        await runStoryScan({
          days,
          ideaLimit: ideas,
          ...(project ? { project } : {}),
          ...(provider ? { provider } : {}),
          ...(topics ? { topics } : {}),
          model: createCommandAuditModel(AGENT_COMMANDS[agent], {
            timeoutMs: 300_000,
          }),
        }),
      ),
  )

  server.tool(
    'storymine_recent_work',
    'List recent tools, projects, configured repositories, packages, and site URLs without running a model.',
    {
      days: z.number().int().min(1).max(365).default(7),
      project: z.string().optional(),
      provider: z.enum(['claude', 'codex']).optional(),
      topics: z.array(z.string().min(1)).max(20).optional(),
    },
    async ({ days, project, provider, topics }) =>
      jsonResult(
        runRecentWorkScan({
          days,
          ...(project ? { project } : {}),
          ...(provider ? { provider } : {}),
          ...(topics ? { topics } : {}),
        }),
      ),
  )

  server.tool(
    'storymine_list_ideas',
    'List mined story ideas without raw transcript content.',
    {
      status: z
        .enum(['new', 'approved', 'rejected', 'needs-work', 'all'])
        .default('new'),
      limit: z.number().int().min(1).max(200).default(20),
    },
    async ({ status, limit }) =>
      jsonResult({ ideas: listStoryIdeas({ status, limit }) }),
  )

  server.tool(
    'storymine_review_idea',
    'Approve, reject, or mark one story idea as needing work.',
    {
      id: z.string().min(1),
      status: z.enum(['approved', 'rejected', 'needs-work']),
      notes: z.string().optional(),
    },
    async ({ id, status, notes }) =>
      jsonResult({
        idea: storyIdeaFromFinding(
          reviewTranscriptFinding({
            id,
            status,
            ...(notes ? { notes } : {}),
          }),
        ),
      }),
  )

  return server
}

export async function startMcpServer(
  options: { test?: boolean } = {},
): Promise<void> {
  if (options.test) {
    process.stdout.write('Storymine MCP server constructed successfully.\n')
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
