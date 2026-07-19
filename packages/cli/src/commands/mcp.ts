import { defineCommand } from 'citty'

export const mcpCommand = defineCommand({
  meta: {
    name: 'mcp',
    description: 'MCP server helpers',
  },
  subCommands: {
    serve: defineCommand({
      meta: {
        name: 'serve',
        description: 'Run the Storymine MCP server',
      },
      args: {
        test: {
          type: 'boolean',
          default: false,
          description: 'Construct the server and exit',
        },
      },
      run: async ({ args }) => {
        const { startMcpServer } = await import('@research/mcp')
        await startMcpServer({ test: Boolean(args.test) })
      },
    }),
  },
})
