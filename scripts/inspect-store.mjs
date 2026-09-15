// Read-only legacy inspection. Print counts, never collection names, IDs, or records.
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'

try {
  if (process.argv.length !== 3) throw new Error('Expected one database path')
  const data = JSON.parse(gunzipSync(await readFile(process.argv[2])).toString('utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unsupported root')
  const result = { collections: 0, records: 0, invalidIds: 0, duplicateIds: 0 }
  for (const collection of Object.values(data).filter(Array.isArray)) {
    result.collections++
    const ids = new Set()
    for (const item of collection) {
      result.records++
      if (!item || typeof item.id !== 'string' || !item.id) result.invalidIds++
      else if (ids.has(item.id)) result.duplicateIds++
      else ids.add(item.id)
    }
  }
  console.log(JSON.stringify(result))
  if (result.invalidIds || result.duplicateIds) process.exitCode = 1
} catch {
  console.error(
    'Cannot inspect database. Expected one readable gzip database with an object root. Contents suppressed.',
  )
  process.exitCode = 2
}
