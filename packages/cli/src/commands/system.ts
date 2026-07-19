import { rmSync } from 'node:fs'
import {
  getPrivacySnapshot,
  getResearchPaths,
  getStorageStats,
  runDoctorChecks,
} from '@research/core'
import { defineCommand } from 'citty'
import { jsonFlag } from '../args.js'
import { formatBytes, printJson, printKeyValue, printTable } from '../utils.js'

export const privacyCommand = defineCommand({
  meta: {
    name: 'privacy',
    description: 'Show local Storymine storage and model boundaries',
  },
  args: {
    json: {
      type: 'boolean',
      default: false,
      description: 'Print structured JSON',
    },
  },
  run: ({ args }) => {
    const snapshot = getPrivacySnapshot()
    const stats = getStorageStats()
    if (jsonFlag(args)) {
      printJson({
        snapshot,
        stats,
        modelBoundary:
          'Redacted excerpts are passed to the model command used by storymine scan.',
      })
      return
    }
    printKeyValue(
      snapshot.map((item) => [
        item.label,
        `${item.path} (${formatBytes(item.sizeBytes)}, ${item.mode})`,
      ]),
    )
    process.stdout.write('\n')
    printKeyValue(
      Object.entries(stats.counts).map(([key, value]) => [key, String(value)]),
    )
    process.stdout.write(
      '\nRedacted excerpts are passed to the model command used by `storymine scan`.\n',
    )
  },
})

export const doctorCommand = defineCommand({
  meta: {
    name: 'doctor',
    description: 'Check local chat sources, model commands, and storage',
  },
  args: {
    json: {
      type: 'boolean',
      default: false,
      description: 'Print structured JSON',
    },
  },
  run: ({ args }) => {
    const checks = runDoctorChecks()
    if (jsonFlag(args)) {
      printJson({ checks })
      return
    }
    printTable(
      ['Check', 'Status', 'Detail'],
      checks.map((check) => [
        check.name,
        check.ok ? 'ok' : 'missing',
        check.detail,
      ]),
    )
  },
})

export const resetCommand = defineCommand({
  meta: {
    name: 'reset',
    description: 'Delete local Storymine config, cache, and logs',
  },
  args: {
    yes: {
      type: 'boolean',
      default: false,
      description: 'Confirm deletion without prompting',
    },
  },
  run: ({ args }) => {
    if (!args.yes) {
      throw new Error('Refusing to reset without --yes')
    }
    const paths = getResearchPaths()
    rmSync(paths.configDir, { recursive: true, force: true })
    rmSync(paths.cacheDir, { recursive: true, force: true })
    rmSync(paths.logDir, { recursive: true, force: true })
    process.stdout.write('Reset complete.\n')
  },
})
