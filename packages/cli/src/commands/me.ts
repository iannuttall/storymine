import {
  collectAndStoreAppUsage,
  collectAndStoreChromeHistory,
} from '@research/core'
import { defineCommand } from 'citty'
import { jsonFlag, numberArg, stringArg } from '../args.js'
import { printJson, printTable } from '../utils.js'

export const meCommand = defineCommand({
  meta: {
    name: 'me',
    description: 'Collect personal local research signals',
  },
  subCommands: {
    apps: defineCommand({
      meta: {
        name: 'apps',
        description: 'Collect Screen Time app usage signals',
      },
      args: {
        days: {
          type: 'string',
          default: '7',
          description: 'Number of days to inspect, 1-30',
        },
        limit: {
          type: 'string',
          default: '30',
          description: 'Maximum apps to return',
        },
        db: {
          type: 'string',
          description: 'Override Screen Time database path',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const dbPath = stringArg(args.db)
        const result = collectAndStoreAppUsage({
          days: numberArg(args.days, 7, { min: 1, max: 30 }),
          limit: numberArg(args.limit, 30, { min: 1, max: 200 }),
          ...(dbPath ? { dbPath } : {}),
        })
        if (jsonFlag(args)) {
          printJson(result)
          return
        }
        printTable(
          ['App', 'Hours', 'Weight'],
          result.signals.map((signal) => [
            signal.title,
            String(signal.metadata.hours ?? ''),
            signal.weight.toFixed(2),
          ]),
        )
      },
    }),
    history: defineCommand({
      meta: {
        name: 'history',
        description: 'Collect Chrome browsing history signals',
      },
      args: {
        days: {
          type: 'string',
          default: '7',
          description: 'Number of days to inspect, 1-365',
        },
        limit: {
          type: 'string',
          default: '40',
          description: 'Maximum URLs to return',
        },
        db: {
          type: 'string',
          description: 'Override Chrome History database path',
        },
        includeNoise: {
          type: 'boolean',
          default: false,
          description: 'Include local, dashboard, and inbox URLs',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Print structured JSON',
        },
      },
      run: ({ args }) => {
        const historyPath = stringArg(args.db)
        const result = collectAndStoreChromeHistory({
          days: numberArg(args.days, 7, { min: 1, max: 365 }),
          limit: numberArg(args.limit, 40, { min: 1, max: 500 }),
          includeNoise: Boolean(args.includeNoise),
          ...(historyPath ? { historyPath } : {}),
        })
        if (jsonFlag(args)) {
          printJson(result)
          return
        }
        printTable(
          ['Title', 'Host', 'Visits'],
          result.signals.map((signal) => [
            signal.title,
            String(signal.metadata.host ?? ''),
            String(signal.metadata.visitCount ?? ''),
          ]),
        )
      },
    }),
  },
})
