import Table from 'cli-table3'

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printTable(headers: string[], rows: string[][]): void {
  const table = new Table({ head: headers })
  for (const row of rows) table.push(row)
  process.stdout.write(`${table.toString()}\n`)
}

export function printKeyValue(rows: Array<[string, string]>): void {
  const width = Math.max(...rows.map(([key]) => key.length), 1)
  for (const [key, value] of rows) {
    process.stdout.write(`${key.padEnd(width)}  ${value}\n`)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
