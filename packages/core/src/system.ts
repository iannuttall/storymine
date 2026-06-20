import { existsSync } from 'node:fs'
import { defaultKnowledgeDbPath } from './collectors/app-usage.js'
import { defaultChromeHistoryPath } from './collectors/chrome-history.js'
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
    pathCheck('Screen Time database', defaultKnowledgeDbPath()),
    pathCheck('Chrome history database', defaultChromeHistoryPath()),
    pathCheck('Claude root', defaultClaudeRoot()),
    pathCheck('Codex root', defaultCodexRoot()),
  ]
}

function pathCheck(name: string, path: string): DoctorCheck {
  return {
    name,
    ok: existsSync(path),
    detail: path,
  }
}
