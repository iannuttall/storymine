import Table from 'cli-table3'

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

export function printTable(headers: string[], rows: string[][]): void {
  const table = new Table({ head: headers })
  for (const row of rows) table.push(row)
  process.stdout.write(`${table.toString()}\n`)
}
