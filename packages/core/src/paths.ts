import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import envPaths from 'env-paths'

export interface ResearchPaths {
  configDir: string
  cacheDir: string
  logDir: string
  configFile: string
  cacheDbFile: string
}

let memoizedPaths: ResearchPaths | undefined

export function getResearchPaths(): ResearchPaths {
  if (memoizedPaths) return memoizedPaths

  const paths = envPaths('research', { suffix: '' })
  const configDir = process.env.RESEARCH_CONFIG_DIR ?? paths.config
  const cacheDir = process.env.RESEARCH_CACHE_DIR ?? paths.cache
  const logDir = process.env.RESEARCH_LOG_DIR ?? paths.log

  memoizedPaths = {
    configDir,
    cacheDir,
    logDir,
    configFile: join(configDir, 'config.json'),
    cacheDbFile: join(cacheDir, 'research.db'),
  }

  return memoizedPaths
}

export function ensureResearchDirs(): ResearchPaths {
  const paths = getResearchPaths()
  mkdirSync(paths.configDir, { recursive: true, mode: 0o700 })
  mkdirSync(paths.cacheDir, { recursive: true, mode: 0o700 })
  mkdirSync(paths.logDir, { recursive: true, mode: 0o700 })
  return paths
}

export function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export function resetResearchPathsForTests(): void {
  memoizedPaths = undefined
}
