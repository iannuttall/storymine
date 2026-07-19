import {
  listStoryIdeas,
  renderStoryIdeasMarkdown,
  reviewTranscriptFinding,
  type StoryIdeaStatus,
  storyIdeaFromFinding,
} from '@research/core'
import { defineCommand } from 'citty'
import { jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson } from '../utils.js'

export const ideasCommand = defineCommand({
  meta: {
    name: 'ideas',
    description: 'Read and review mined story ideas',
  },
  args: {
    action: {
      type: 'positional',
      required: false,
      description: 'Optional review action: approve, reject, or needs-work',
    },
    id: {
      type: 'positional',
      required: false,
      description: 'Story idea id when reviewing an idea',
    },
    status: {
      type: 'string',
      default: 'new',
      description: 'Ideas to show: new, approved, rejected, needs-work, or all',
    },
    limit: {
      type: 'string',
      default: '20',
      description: 'Maximum ideas to show',
    },
    json: {
      type: 'boolean',
      default: false,
      description: 'Print structured JSON',
    },
    notes: {
      type: 'string',
      description: 'Optional review notes',
    },
  },
  run: ({ args }) => {
    const action = stringArg(args.action)
    if (action) {
      reviewIdea(
        action,
        stringArg(args.id),
        stringArg(args.notes),
        jsonFlag(args),
      )
      return
    }
    const ideas = listStoryIdeas({
      status: statusArg(args.status),
      limit: numberArg(args.limit, 20, { min: 1, max: 200 }),
    })
    if (jsonFlag(args)) {
      printJson({ ideas })
      return
    }
    process.stdout.write(renderStoryIdeasMarkdown(ideas))
  },
})

function reviewIdea(
  action: string,
  id: string | undefined,
  notes: string | undefined,
  json: boolean,
): void {
  const status = reviewStatusArg(action)
  if (!id) throw new Error(`Use storymine ideas ${action} <id>`)
  const finding = reviewTranscriptFinding({
    id,
    status,
    ...(notes ? { notes } : {}),
  })
  const idea = storyIdeaFromFinding(finding)
  if (json) {
    printJson({ idea })
    return
  }
  process.stdout.write(`${idea.status}: ${idea.title}\n`)
}

function reviewStatusArg(
  action: string,
): 'approved' | 'rejected' | 'needs-work' {
  if (action === 'approve') return 'approved'
  if (action === 'reject') return 'rejected'
  if (action === 'needs-work') return 'needs-work'
  throw new Error('Review action must be approve, reject, or needs-work')
}

function statusArg(value: unknown): StoryIdeaStatus | 'all' {
  const status = stringArg(value) ?? 'new'
  if (
    status === 'new' ||
    status === 'approved' ||
    status === 'rejected' ||
    status === 'needs-work' ||
    status === 'all'
  ) {
    return status
  }
  throw new Error(
    '--status must be new, approved, rejected, needs-work, or all',
  )
}
