import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runStoryScan } from './scan.js'
import { openResearchDb } from './storage/database.js'
import type { TranscriptAuditModel } from './transcripts/audit.js'

const SUMMARY = JSON.stringify({
  summary:
    'Built a logo reconstruction CLI after automatic tracing produced noisy SVG paths.',
  built: 'logo reconstruction CLI',
  problems: 'Automatic tracing produced path soup.',
  failedApproaches: ['Automatic tracing damaged the curved caps.'],
  whatWorked: 'Measured circles and shared slopes, then compared renders.',
  toolsCreated: ['logo CLI'],
  opinions: [],
  friction: [
    'The human stopped another tracing attempt and asked for measurement.',
  ],
})

const STORY = JSON.stringify({
  title: 'Rebuilt a raster logo from measured geometry',
  concreteProblem:
    'An antialiased logo.png had no source vector, and automatic tracing produced hundreds of noisy SVG points.',
  failedApproaches:
    'Automatic tracing in trace.py created path soup, while threshold masks damaged the curved caps.',
  nonObviousMove:
    'Measured circles and shared slopes in measure.py, then rebuilt the intended geometry instead of tracing pixels.',
  reusableRecipe:
    'Render output.svg, compare it with the source in metrics.py, tune shared geometry, and repeat until edges align.',
  evidence:
    'The final output.svg reached 0.998 silhouette IoU and all 19 reconstruction tests passed.',
  confidence: 0.94,
})

test('runStoryScan completes the v1 workflow with bounded model calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storymine-scan-'))
  try {
    const codexRoot = join(dir, '.codex')
    const claudeRoot = join(dir, '.claude')
    const devRoot = join(dir, 'dev')
    const project = join(devRoot, 'sandbox', 'logo-tool')
    const sessionDir = join(codexRoot, 'sessions', '2026', '07', '19')
    mkdirSync(sessionDir, { recursive: true })
    mkdirSync(join(claudeRoot, 'projects'), { recursive: true })
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'logo.png'), 'fixture')
    writeFileSync(
      join(project, 'pyproject.toml'),
      '[project]\nname = "logo-tool"\n',
    )
    writeFileSync(
      join(sessionDir, 'rollout.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: new Date().toISOString(),
          payload: { id: 'session-1', cwd: project },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: new Date().toISOString(),
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Automatic tracing failed. Stop and rebuild the logo from measured geometry.',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: new Date().toISOString(),
          payload: {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [
              {
                type: 'output_text',
                text: 'Created a new logo CLI. The final metric is 0.998 and all 19 tests passed.',
              },
            ],
          },
        }),
      ].join('\n'),
    )

    let calls = 0
    const model: TranscriptAuditModel = {
      async complete(prompt) {
        calls += 1
        return prompt.includes('summarizing one AI coding session')
          ? SUMMARY
          : STORY
      },
    }
    const db = openResearchDb(join(dir, 'storymine.db'))
    const result = await runStoryScan({
      model,
      days: 7,
      ideaLimit: 5,
      now: Date.now(),
      claudeRoot,
      codexRoot,
      database: db,
    })

    assert.equal(result.transcripts.filesFound, 1)
    assert.equal(result.transcripts.sessionsFound, 1)
    assert.equal(result.selectedSessions, 1)
    assert.equal(result.recentWork.length, 1)
    assert.equal(result.recentWork[0]?.name, 'logo-tool')
    assert.equal(result.summaries.created, 1)
    assert.equal(result.mining.created, 1)
    assert.equal(result.ideas.length, 1)
    assert.equal(calls, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
