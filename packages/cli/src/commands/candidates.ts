import {
  listStoredCandidates,
  promoteTranscriptFindings,
  renderCandidatesMarkdown,
} from '@research/core'
import { defineCommand } from 'citty'
import { floatArg, jsonFlag, numberArg } from '../args.js'
import { printJson, printTable } from '../utils.js'

export const candidatesCommand = defineCommand({
  meta: {
    name: 'candidates',
    description: 'Promote, list, and export research candidates',
  },
  subCommands: {
    promote: defineCommand({
      meta: {
        name: 'promote',
        description: 'Promote high-confidence transcript findings',
      },
      args: {
        minConfidence: {
          type: 'string',
          default: '0.7',
          description: 'Minimum finding confidence, 0-1',
        },
        limit: {
          type: 'string',
          default: '25',
          description: 'Maximum findings to promote',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const result = promoteTranscriptFindings({
          minConfidence: floatArg(args.minConfidence, 0.7, { min: 0, max: 1 }),
          limit: numberArg(args.limit, 25, { min: 1, max: 500 }),
        })
        if (jsonFlag(args)) {
          printJson(result)
          return
        }
        printTable(
          ['Promoted', 'Candidates'],
          [[String(result.promoted), String(result.candidates.length)]],
        )
      },
    }),
    list: defineCommand({
      meta: {
        name: 'list',
        description: 'List stored research candidates',
      },
      args: {
        limit: {
          type: 'string',
          default: '50',
          description: 'Maximum candidates to list',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const candidates = listStoredCandidates({
          limit: numberArg(args.limit, 50, { min: 1, max: 1000 }),
        })
        if (jsonFlag(args)) {
          printJson({ candidates })
          return
        }
        printTable(
          ['Name', 'Source', 'Tier'],
          candidates.map((candidate) => [
            candidate.name,
            candidate.source,
            candidate.tier,
          ]),
        )
      },
    }),
    export: defineCommand({
      meta: {
        name: 'export',
        description: 'Export candidates for draft agents',
      },
      args: {
        format: {
          type: 'string',
          default: 'markdown',
          description: 'Export format: markdown or json',
        },
        limit: {
          type: 'string',
          default: '50',
          description: 'Maximum candidates to export',
        },
      },
      run: ({ args }) => {
        const candidates = listStoredCandidates({
          limit: numberArg(args.limit, 50, { min: 1, max: 1000 }),
        })
        if (args.format === 'json') {
          printJson({ candidates })
          return
        }
        process.stdout.write(renderCandidatesMarkdown(candidates))
      },
    }),
  },
})
