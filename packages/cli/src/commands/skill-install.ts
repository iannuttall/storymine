import { spawnSync } from 'node:child_process'

export type SkillInstallOutcome =
  | { status: 'installed' }
  | { status: 'failed'; error: string }

interface InstallerResult {
  status: number | null
  error?: Error
}

export interface SkillInstallOptions {
  quiet?: boolean
  runner?: (
    command: string,
    args: string[],
    options: { stdio: 'ignore' | 'inherit' },
  ) => InstallerResult
}

export function installStorymineSkill(
  options: SkillInstallOptions = {},
): SkillInstallOutcome {
  const runner =
    options.runner ??
    ((command, args, spawnOptions) => spawnSync(command, args, spawnOptions))
  const result = runner(
    'npx',
    ['-y', 'skills', 'add', 'iannuttall/storymine'],
    { stdio: options.quiet ? 'ignore' : 'inherit' },
  )
  if (result.error) {
    return { status: 'failed', error: result.error.message }
  }
  if (result.status !== 0) {
    return {
      status: 'failed',
      error: `npx skills add exited with status ${result.status ?? 'unknown'}`,
    }
  }
  return { status: 'installed' }
}
