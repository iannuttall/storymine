import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))

test('the public package exposes one API, CLI, and MCP surface', () => {
  assert.equal(packageJson.name, 'storymine')
  assert.equal(packageJson.private, undefined)
  assert.equal(packageJson.bin.storymine, './dist/cli.js')
  assert.equal(packageJson.exports['.'].import, './dist/index.js')
  assert.equal(packageJson.exports['./mcp'].import, './dist/mcp.js')
  assert.equal(packageJson.license, 'Apache-2.0')
  assert.equal(
    packageJson.repository.url,
    'git+https://github.com/iannuttall/storymine.git',
  )
})

test('the public library and MCP entry points load', async () => {
  const [core, mcp] = await Promise.all([
    import('../dist/index.js'),
    import('../dist/mcp.js'),
  ])
  assert.equal(typeof core.runStoryScan, 'function')
  assert.equal(typeof core.listStoryIdeas, 'function')
  assert.equal(typeof mcp.createServer, 'function')
})

test('runtime bundles do not depend on private workspace packages', async () => {
  const files = (await readdir('dist')).filter((file) => file.endsWith('.js'))
  assert.ok(files.length >= 3)
  for (const file of files) {
    const source = await readFile(`dist/${file}`, 'utf8')
    assert.doesNotMatch(source, /(?:from\s*|import\()['"]@research\//)
  }
})

test('the packaged CLI is executable and reports the package version', async () => {
  const cli = await readFile('dist/cli.js', 'utf8')
  assert.match(cli, /^#!\/usr\/bin\/env node\n/)
  const result = await execFileAsync(
    process.execPath,
    ['dist/cli.js', '--version'],
    {
      env: { ...process.env, CI: 'true' },
    },
  )
  assert.equal(result.stdout.trim(), packageJson.version)
})

test('the package ships its skill and privacy documents', async () => {
  assert.ok(packageJson.files.includes('skills'))
  assert.ok(packageJson.files.includes('PRIVACY.md'))
  assert.ok(packageJson.files.includes('SECURITY.md'))
  await Promise.all([
    readFile('skills/storymine/SKILL.md', 'utf8'),
    readFile('PRIVACY.md', 'utf8'),
    readFile('SECURITY.md', 'utf8'),
  ])
})
