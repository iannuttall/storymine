import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const tempRoot = await mkdtemp(join(tmpdir(), 'storymine-package-'))
const archiveDir = join(tempRoot, 'archive')
const consumerDir = join(tempRoot, 'consumer')
const globalPrefix = join(tempRoot, 'global')
const cacheDir = join(tempRoot, 'cache')
const configDir = join(tempRoot, 'config')
const logDir = join(tempRoot, 'logs')

after(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function env() {
  const cleanProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toLowerCase().startsWith('npm_config_'),
    ),
  )
  return {
    ...cleanProcessEnv,
    STORYMINE_CACHE_DIR: cacheDir,
    STORYMINE_CONFIG_DIR: configDir,
    STORYMINE_LOG_DIR: logDir,
  }
}

async function packedTarball() {
  await mkdir(archiveDir, { recursive: true })
  await execFileAsync(
    'npm',
    ['pack', '--ignore-scripts', '--pack-destination', archiveDir],
    { cwd: root, env: env() },
  )
  const archive = (await readdir(archiveDir)).find((file) =>
    /^storymine-[\d.]+\.tgz$/.test(file),
  )
  assert.ok(archive)
  return join(archiveDir, archive)
}

function assertCleanInstall(output) {
  const combined = `${output.stdout}\n${output.stderr}`
  assert.doesNotMatch(combined, /npm warn|deprecated|allow-scripts/i)
}

test('the packed package installs and runs without the workspace', {
  timeout: 120_000,
}, async () => {
  const tarball = await packedTarball()
  await mkdir(consumerDir)
  await writeFile(
    join(consumerDir, 'package.json'),
    JSON.stringify({
      name: 'storymine-consumer',
      private: true,
      type: 'module',
    }),
  )
  const localInstall = await execFileAsync(
    'npm',
    ['install', '--no-audit', '--no-fund', tarball],
    {
      cwd: consumerDir,
      env: env(),
      maxBuffer: 1024 * 1024,
    },
  )
  assertCleanInstall(localInstall)

  const cli = join(consumerDir, 'node_modules', 'storymine', 'dist', 'cli.js')
  const version = await execFileAsync(process.execPath, [cli, '--version'], {
    cwd: consumerDir,
    env: env(),
  })
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/)

  const privacy = await execFileAsync(
    process.execPath,
    [cli, 'privacy', '--json'],
    { cwd: consumerDir, env: env() },
  )
  assert.match(JSON.parse(privacy.stdout).stats.dbPath, /storymine\.db$/)

  const mcp = await execFileAsync(
    process.execPath,
    [cli, 'mcp', 'serve', '--test'],
    { cwd: consumerDir, env: env() },
  )
  assert.match(mcp.stdout, /MCP server constructed successfully/)

  const library = await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      "import { runStoryScan, listStoryIdeas } from 'storymine'; import { createServer } from 'storymine/mcp'; if (typeof runStoryScan !== 'function' || typeof listStoryIdeas !== 'function' || typeof createServer !== 'function') process.exit(1)",
    ],
    { cwd: consumerDir, env: env() },
  )
  assert.equal(library.stderr, '')

  const globalInstall = await execFileAsync(
    'npm',
    [
      'install',
      '--global',
      '--prefix',
      globalPrefix,
      '--no-audit',
      '--no-fund',
      tarball,
    ],
    {
      cwd: tempRoot,
      env: env(),
      maxBuffer: 1024 * 1024,
    },
  )
  assertCleanInstall(globalInstall)

  const globalVersion = await execFileAsync(
    join(globalPrefix, 'bin', 'storymine'),
    ['--version'],
    { cwd: tempRoot, env: env() },
  )
  assert.match(globalVersion.stdout.trim(), /^\d+\.\d+\.\d+$/)
})
