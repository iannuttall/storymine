import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { scanArtifacts } from './scan.js'

function gitAvailable(): boolean {
  try {
    return spawnSync('git', ['--version']).status === 0
  } catch {
    return false
  }
}

function initRepo(dir: string): void {
  const opts = { cwd: dir, encoding: 'utf8' as const }
  spawnSync('git', ['init', '-q'], opts)
  spawnSync('git', ['config', 'user.email', 'test@example.com'], opts)
  spawnSync('git', ['config', 'user.name', 'Test'], opts)
  writeFileSync(join(dir, 'index.js'), 'console.log(1)\n')
  spawnSync('git', ['add', '.'], opts)
  spawnSync('git', ['commit', '-q', '-m', 'initial commit'], opts)
}

test('scanArtifacts finds sandbox projects and skill files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-artifacts-'))
  try {
    const root = join(dir, 'dev')
    const sandboxRoot = join(root, 'sandbox')
    mkdirSync(join(sandboxRoot, 'png-to-svg', 'skills', 'png2svg'), {
      recursive: true,
    })
    writeFileSync(
      join(sandboxRoot, 'png-to-svg', 'main.py'),
      'print("hello")\n',
    )
    writeFileSync(
      join(sandboxRoot, 'png-to-svg', 'skills', 'png2svg', 'SKILL.md'),
      '# png2svg\n',
    )
    // A non-git directory must not crash the scan.
    mkdirSync(join(root, 'notes'), { recursive: true })
    writeFileSync(join(root, 'notes', 'todo.txt'), 'stuff\n')

    const result = scanArtifacts({
      root,
      sandboxRoot,
      days: 365,
      now: Date.now(),
    })
    const kinds = new Set(result.artifacts.map((artifact) => artifact.kind))
    assert.ok(kinds.has('sandbox-project'), 'finds sandbox project')
    assert.ok(kinds.has('skill'), 'finds skill file')
    const sandbox = result.artifacts.find(
      (artifact) => artifact.kind === 'sandbox-project',
    )
    assert.equal(sandbox?.name, 'png-to-svg')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanArtifacts detects a brand new git repo within the window', {
  skip: gitAvailable() ? false : 'git not available',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-artifacts-git-'))
  try {
    const root = join(dir, 'dev')
    const repo = join(root, 'cli', 'fresh-tool')
    mkdirSync(repo, { recursive: true })
    initRepo(repo)

    const result = scanArtifacts({ root, days: 365, now: Date.now() })
    const repoArtifact = result.artifacts.find(
      (artifact) => artifact.path === repo,
    )
    assert.ok(repoArtifact, 'repo artifact present')
    assert.ok(
      repoArtifact?.kind === 'new-repo' ||
        repoArtifact?.kind === 'git-repo-active',
      'repo classified as git artifact',
    )
    assert.equal(repoArtifact?.detail.commitCount, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scanArtifacts excludes changes outside the window', {
  skip: gitAvailable() ? false : 'git not available',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'research-artifacts-old-'))
  try {
    const root = join(dir, 'dev')
    const repo = join(root, 'cli', 'old-tool')
    mkdirSync(repo, { recursive: true })
    initRepo(repo)

    // now is far in the future, so the fresh commit is outside a 1-day window.
    const result = scanArtifacts({
      root,
      days: 1,
      now: Date.now() + 30 * 86_400_000,
    })
    assert.equal(
      result.artifacts.find((artifact) => artifact.path === repo),
      undefined,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
