import type { ParsedArgs } from 'citty'

export function booleanArg(value: unknown): boolean {
  return value === true || value === 'true'
}

export function jsonFlag(args: ParsedArgs): boolean {
  return booleanArg(args.json)
}

export function numberArg(
  value: unknown,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const min = options.min ?? Number.NEGATIVE_INFINITY
  const max = options.max ?? Number.POSITIVE_INFINITY
  return Math.max(min, Math.min(Math.trunc(parsed), max))
}

export function floatArg(
  value: unknown,
  fallback: number,
  options: { min?: number; max?: number } = {},
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  const min = options.min ?? Number.NEGATIVE_INFINITY
  const max = options.max ?? Number.POSITIVE_INFINITY
  return Math.max(min, Math.min(parsed, max))
}

export function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
