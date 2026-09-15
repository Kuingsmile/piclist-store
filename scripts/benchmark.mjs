import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'

import { DBStore as LegacyDBStore } from 'store-legacy'

import { DBStore } from '../dist/index.js'

const root = await mkdtemp(join(tmpdir(), 'store-benchmark-'))
const sizes = process.argv.slice(2).map(Number)
if (sizes.length === 0) sizes.push(1_000, 10_000)
if (sizes.some(size => !Number.isSafeInteger(size) || size < 1 || size > 100_000)) {
  throw new Error('Use integer dataset sizes between 1 and 100000')
}

for (const size of sizes) {
  const items = Array.from({ length: size }, (_, i) => ({
    id: String(i),
    createdAt: i,
    updatedAt: i,
    title: 'Synthetic image ' + i,
    tags: ['benchmark'],
  }))
  const data = { items, __items_KEY__: Object.fromEntries(items.map(item => [item.id, 1])) }
  const buffer = gzipSync(JSON.stringify(data))
  for (const [version, Store] of [
    ['3.0.1', LegacyDBStore],
    ['current', DBStore],
  ]) {
    const path = join(root, version + '-' + size + '.db')
    await writeFile(path, buffer)
    const db = new Store(path, 'items')
    const startRead = performance.now()
    await db.get()
    const readMs = performance.now() - startRead
    const updates = items.map(item => ({ id: item.id, benchmarkUpdated: true }))
    const startUpdate = performance.now()
    await db.updateMany(updates)
    const updateManyMs = performance.now() - startUpdate
    const reopened = await new Store(path, 'items').get()
    assert.equal(reopened.total, size)
    assert.ok(reopened.data.every(item => item.benchmarkUpdated))
    console.log(JSON.stringify({ version, records: size, compressedBytes: buffer.length, readMs, updateManyMs }))
  }
}
