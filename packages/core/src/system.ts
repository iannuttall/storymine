import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ensureResearchDirs, fileSize, getResearchPaths } from './paths.js'
import { getStorageStats } from './storage/database.js'
import { defaultClaudeRoot, defaultCodexRoot } from './transcripts/discovery.js'

export interface PrivacyItem {
  label: string
  path: string
  sizeBytes: number
  mode: 'config' | 'cache' | 'logs' | 'database'
}

export interface DoctorCheck {
  name: string
  ok: boolean
  detail: string
}

export function getPrivacySnapshot(): PrivacyItem[] {
  const paths = getResearchPaths()
  return [
    {
      label: 'Config directory',
      path: paths.configDir,
      sizeBytes: fileSize(paths.configDir),
      mode: 'config',
    },
    {
      label: 'Cache directory',
      path: paths.cacheDir,
      sizeBytes: fileSize(paths.cacheDir),
      mode: 'cache',
    },
    {
      label: 'Log directory',
      path: paths.logDir,
      sizeBytes: fileSize(paths.logDir),
      mode: 'logs',
    },
    {
      label: 'SQLite database',
      path: getStorageStats().dbPath,
      sizeBytes: getStorageStats().sizeBytes,
      mode: 'database',
    },
  ]
}

export function runDoctorChecks(): DoctorCheck[] {
  ensureResearchDirs()
  const paths = getResearchPaths()
  return [
    pathCheck('Config directory', paths.configDir),
    pathCheck('Cache directory', paths.cacheDir),
    pathCheck('Claude chats', defaultClaudeRoot()),
    pathCheck('Codex chats', defaultCodexRoot()),
    checkCommandAvailability('Codex command', 'codex'),
    checkCommandAvailability('Claude command', 'claude'),
  ]
}

export function checkCommandAvailability(
  name: string,
  command: string,
): DoctorCheck {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 3000,
  })
  const ok = result.status === 0
  const output =
    typeof result.stdout === 'string' && result.stdout.trim()
      ? result.stdout.trim()
      : typeof result.stderr === 'string' && result.stderr.trim()
        ? result.stderr.trim()
        : null
  return {
    name,
    ok,
    detail: ok
      ? (output ?? command)
      : result.error && 'code' in result.error && result.error.code === 'ENOENT'
        ? `${command} not found in PATH`
        : (output ?? `${command} could not run`),
  }
}

function pathCheck(name: string, path: string): DoctorCheck {
  return {
    name,
    ok: existsSync(path),
    detail: path,
  }
}
