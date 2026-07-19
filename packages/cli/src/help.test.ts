import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installStorymineSkill } from './commands/skill-install.js'

const { test } = createRequire(import.meta.url)(
  'node:test',
) as typeof import('node:test')

function cli(...args: string[]) {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const dataRoot = mkdtempSync(join(tmpdir(), 'storymine-cli-test-'))
  return spawnSync(process.execPath, [join(distDir, 'index.js'), ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      STORYMINE_CACHE_DIR: join(dataRoot, 'cache'),
      STORYMINE_CONFIG_DIR: join(dataRoot, 'config'),
      STORYMINE_LOG_DIR: join(dataRoot, 'logs'),
    },
  })
}

test('storymine --help keeps the main workflow small', () => {
  const result = cli('--help')

  assert.equal(result.status, 0)
  assert.match(result.stdout, /storymine scan/)
  assert.match(result.stdout, /storymine work/)
  assert.match(result.stdout, /storymine ideas/)
  assert.match(result.stdout, /storymine privacy/)
  assert.match(result.stdout, /storymine skill install/)
  assert.doesNotMatch(result.stdout, /transcripts index/)
  assert.doesNotMatch(result.stdout, /candidates promote/)
})

test('storymine skill installer delegates to the skills CLI', () => {
  let invocation: { command: string; args: string[]; stdio: string } | null =
    null
  const result = installStorymineSkill({
    quiet: true,
    runner(command, args, options) {
      invocation = { command, args, stdio: options.stdio }
      return { status: 0 }
    },
  })

  assert.deepEqual(result, { status: 'installed' })
  assert.deepEqual(invocation, {
    command: 'npx',
    args: ['-y', 'skills', 'add', 'iannuttall/storymine'],
    stdio: 'ignore',
  })
})

test('storymine skill installer returns command failures', () => {
  const result = installStorymineSkill({
    runner() {
      return { status: 1 }
    },
  })

  assert.deepEqual(result, {
    status: 'failed',
    error: 'npx skills add exited with status 1',
  })
})

test('storymine work is deterministic and exposes no model flags', () => {
  const result = cli('work', '--help')

  assert.equal(result.status, 0)
  for (const flag of ['--days', '--project', '--provider', '--topics']) {
    assert.match(result.stdout, new RegExp(flag))
  }
  assert.doesNotMatch(result.stdout, /--agent|--command|--ideas/)
})

test('storymine scan --help only exposes useful human choices', () => {
  const result = cli('scan', '--help')

  assert.equal(result.status, 0)
  for (const flag of [
    '--days',
    '--project',
    '--provider',
    '--ideas',
    '--topics',
    '--agent',
  ]) {
    assert.match(result.stdout, new RegExp(flag))
  }
  for (const internalFlag of [
    '--command',
    '--maxTokens',
    '--timeoutSeconds',
    '--concurrency',
  ]) {
    assert.doesNotMatch(result.stdout, new RegExp(internalFlag))
  }
})

test('storymine ideas approve accepts the id as a positional argument', () => {
  const result = cli('ideas', 'approve', '--help')

  assert.equal(result.status, 0)
  assert.match(result.stdout, /\[ACTION\]/)
  assert.match(result.stdout, /\[ID\]/)
  assert.match(result.stdout, /--notes/)
})

test('storymine ideas accepts conventional spaced option values', () => {
  const result = cli('ideas', '--limit', '5', '--json')

  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(result.stdout), { ideas: [] })
})

test('power-tool transcript search help remains available', () => {
  const result = cli('me', 'transcripts', 'search', '--help')

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Search parsed transcript chunks/)
  assert.match(result.stdout, /--query/)
})
