import assert from 'node:assert/strict'
import test from 'node:test'
import { checkCommandAvailability, runDoctorChecks } from './system.js'

test('doctor always checks both supported scan agents', () => {
  const checks = runDoctorChecks()
  assert.ok(checks.some((check) => check.name === 'Codex command'))
  assert.ok(checks.some((check) => check.name === 'Claude command'))
})

test('command availability explains when an agent is not installed', () => {
  const check = checkCommandAvailability(
    'Missing command',
    'storymine-command-that-does-not-exist',
  )
  assert.deepEqual(check, {
    name: 'Missing command',
    ok: false,
    detail: 'storymine-command-that-does-not-exist not found in PATH',
  })
})

test('command availability returns the installed version', () => {
  const check = checkCommandAvailability('Node command', process.execPath)
  assert.equal(check.ok, true)
  assert.match(check.detail, /^v\d+/)
})
