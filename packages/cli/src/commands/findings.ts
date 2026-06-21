import {
  listTranscriptFindingReviews,
  renderTranscriptFindingReviewsMarkdown,
  reviewStatusForFinding,
  reviewTranscriptFinding,
  type TranscriptFinding,
  type TranscriptFindingReviewStatus,
} from '@research/core'
import { defineCommand } from 'citty'
import { floatArg, jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson, printTable } from '../utils.js'

export const findingsCommand = defineCommand({
  meta: {
    name: 'findings',
    description: 'Review transcript findings before promotion/export',
  },
  subCommands: {
    review: defineCommand({
      meta: {
        name: 'review',
        description: 'List transcript findings for human review',
      },
      args: {
        status: {
          type: 'string',
          default: 'unreviewed',
          description:
            'Review status: unreviewed, approved, rejected, needs-work, all',
        },
        minConfidence: {
          type: 'string',
          default: '0.7',
          description: 'Minimum finding confidence, 0-1',
        },
        limit: {
          type: 'string',
          default: '20',
          description: 'Maximum findings to list',
        },
        markdown: {
          type: 'boolean',
          default: false,
          description: 'Print agent-readable markdown',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const findings = listTranscriptFindingReviews({
          status: reviewStatusArg(args.status),
          minConfidence: floatArg(args.minConfidence, 0.7, { min: 0, max: 1 }),
          limit: numberArg(args.limit, 20, { min: 1, max: 1000 }),
        })
        if (jsonFlag(args)) {
          printJson({ findings })
          return
        }
        if (args.markdown) {
          process.stdout.write(renderTranscriptFindingReviewsMarkdown(findings))
          return
        }
        printTable(
          ['ID', 'Status', 'Confidence', 'Lesson'],
          findingRows(findings),
        )
      },
    }),
    approve: reviewCommand('approve', 'approved'),
    reject: reviewCommand('reject', 'rejected'),
    'needs-work': reviewCommand('needs-work', 'needs-work'),
  },
})

function reviewCommand(
  name: string,
  status: Exclude<TranscriptFindingReviewStatus, 'unreviewed' | 'all'>,
) {
  return defineCommand({
    meta: {
      name,
      description: `Mark a transcript finding as ${status}`,
    },
    args: {
      id: {
        type: 'string',
        description: 'Transcript finding id',
      },
      notes: {
        type: 'string',
        description: 'Optional review notes',
      },
      json: {
        type: 'boolean',
        default: false,
        description: 'Print structured JSON',
      },
    },
    run: ({ args }) => {
      const id = stringArg(args.id)
      if (!id) throw new Error('Pass --id <finding>')
      const notes = stringArg(args.notes)
      const finding = reviewTranscriptFinding({
        id,
        status,
        ...(notes ? { notes } : {}),
      })
      if (jsonFlag(args)) {
        printJson({ finding })
        return
      }
      printTable(
        ['ID', 'Status', 'Lesson'],
        [[finding.id, reviewStatusForFinding(finding), finding.lesson]],
      )
    },
  })
}

function reviewStatusArg(value: unknown): TranscriptFindingReviewStatus {
  const raw = stringArg(value)
  if (
    raw === 'approved' ||
    raw === 'rejected' ||
    raw === 'needs-work' ||
    raw === 'all'
  ) {
    return raw
  }
  return 'unreviewed'
}

function findingRows(findings: TranscriptFinding[]): string[][] {
  return findings.map((finding) => [
    finding.id,
    reviewStatusForFinding(finding),
    finding.confidence.toFixed(2),
    finding.lesson,
  ])
}
