import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverTranscriptFiles } from './discovery.js'

test('discoverTranscriptFiles finds claude and codex jsonl files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-transcripts-'))
  try {
    const claudeRoot = join(dir, '.claude')
    const codexRoot = join(dir, '.codex')
    mkdirSync(join(claudeRoot, 'projects', 'example'), { recursive: true })
    mkdirSync(join(codexRoot, 'sessions', '2026', '06', '20'), {
      recursive: true,
    })
    writeFileSync(
      join(claudeRoot, 'projects', 'example', 'session.jsonl'),
      '{"type":"user"}\n',
    )
    writeFileSync(
      join(codexRoot, 'sessions', '2026', '06', '20', 'rollout.jsonl'),
      '{"type":"session_meta"}\n',
    )
    writeFileSync(join(codexRoot, 'sessions', 'ignore.txt'), 'nope')

    const files = discoverTranscriptFiles({
      claudeRoot,
      codexRoot,
      providers: ['claude', 'codex'],
    })

    assert.equal(files.length, 2)
    assert.deepEqual(files.map((file) => file.provider).sort(), [
      'claude',
      'codex',
    ])
    assert.ok(files.every((file) => file.status === 'pending'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
