export interface RedactionResult {
  text: string
  count: number
}

const patterns: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]'],
  [/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_SECRET]'],
  [
    /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._~:/+=-]{12,}["']?/gi,
    '[REDACTED_SECRET]',
  ],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_SECRET]'],
  [
    /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g,
    '[REDACTED_SECRET]',
  ],
]

export function redactText(input: string): RedactionResult {
  let text = input
  let count = 0
  for (const [pattern, replacement] of patterns) {
    text = text.replace(pattern, () => {
      count += 1
      return replacement
    })
  }
  return { text, count }
}
