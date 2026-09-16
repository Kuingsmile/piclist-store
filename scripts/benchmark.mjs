import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'

import { DBStore as LegacyDBStore, JSONStore as LegacyJSONStore } from 'store-legacy'

import { DBStore, JSONStore } from '../dist/index.js'

const sizes = []
let runs = 1
let jsonOutput = false
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') {
    jsonOutput = true
  } else if (args[i] === '--runs') {
    runs = Number(args[++i])
    if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) {
      throw new Error('Use --runs with an integer between 1 and 20')
    }
  } else if (args[i] === '--help') {
    console.log('Usage: yarn benchmark [sizes...] [--runs 1..20] [--json]')
    console.log('Defaults: sizes 1000 10000, one run. Multiple runs report median elapsed time.')
    process.exit(0)
  } else {
    const size = Number(args[i])
    if (!Number.isSafeInteger(size) || size < 1 || size > 100_000) {
      throw new Error('Use integer dataset sizes between 1 and 100000, --runs, or --json')
    }
    sizes.push(size)
  }
}
if (sizes.length === 0) sizes.push(1_000, 10_000)

const versions = [
  { version: '3.0.1', DBStore: LegacyDBStore, JSONStore: LegacyJSONStore },
  { version: 'current', DBStore, JSONStore },
]
const readCalls = 100
// Legacy batch inserts and the fallbacks below write the whole file per item.
const maxBatchSize = 25
const root = await mkdtemp(join(tmpdir(), 'store-benchmark-'))

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

async function repeatAsync(count, operation) {
  const results = []
  for (let i = 0; i < count; i++) results.push(await operation(i))
  return results
}

function repeatSync(count, operation) {
  return Array.from({ length: count }, (_, i) => operation(i))
}

// Timestamps intentionally differ between versions; compare the application data.
function withoutMetadata(items) {
  return items.map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...item }) => item)
}

function printTable(report) {
  if (jsonOutput) {
    console.log(JSON.stringify(report))
    return
  }
  console.log(
    `\n${report.store} | ${report.records.toLocaleString('en-US')} records | ` +
      `${report.fixtureBytes.toLocaleString('en-US')} fixture bytes | ${report.runs} run(s), median ms`,
  )
  const rows = report.results.map(result => [
    result.operation,
    result.work,
    result.legacyMs.toFixed(3),
    result.currentMs.toFixed(3),
    result.speedup === null
      ? 'n/a'
      : result.speedup >= 1
        ? `${result.speedup.toFixed(2)}x faster`
        : `${(1 / result.speedup).toFixed(2)}x slower`,
  ])
  const headers = ['Operation', 'Work / run', '3.0.1 (ms)', 'Current (ms)', 'Current vs 3.0.1']
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => row[i].length)))
  const format = row => row.map((cell, i) => (i >= 2 ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join('  ')
  console.log(format(headers))
  console.log(widths.map(width => '-'.repeat(width)).join('  '))
  for (const row of rows) console.log(format(row))
  for (const result of report.results.filter(result => result.note)) {
    console.log(`  ${result.operation}: ${result.note}`)
  }
}

async function compare(store, records, fixture, cases) {
  const results = []
  for (const scenario of cases) {
    const timings = { '3.0.1': [], current: [] }
    for (let run = 0; run < runs; run++) {
      // Alternate version order when repeating, with a fresh fixture for every measurement.
      for (const version of run % 2 ? [...versions].reverse() : versions) {
        const path = join(root, `${store}-${version.version}.data`)
        await writeFile(path, fixture)
        const Store = version[store]
        const open = () => (store === 'DBStore' ? new Store(path, 'items') : new Store(path))
        const db = scenario.cold ? undefined : open()
        if (db) await db.read()
        const start = performance.now()
        let result = scenario.run(db, open)
        if (result && typeof result.then === 'function') result = await result
        timings[version.version].push(performance.now() - start)
        // All assertions and disk roundtrips are outside the measured interval.
        scenario.verify?.(result)
        if (scenario.expected) {
          const reopened = open()
          if (store === 'DBStore') {
            const persisted = await reopened.get()
            assert.equal(persisted.total, scenario.expected.length)
            assert.deepEqual(withoutMetadata(persisted.data), withoutMetadata(scenario.expected))
            assert.equal(reopened.errorList.length, 0)
          } else {
            assert.deepEqual(JSON.parse(JSON.stringify(reopened.read())), scenario.expected)
          }
        }
        if (db?.errorList) assert.equal(db.errorList.length, 0)
      }
    }
    const legacyMs = median(timings['3.0.1'])
    const currentMs = median(timings.current)
    results.push({
      operation: scenario.name,
      work: scenario.work ?? '1 call',
      legacyMs,
      currentMs,
      speedup: legacyMs > 0 && currentMs > 0 ? legacyMs / currentMs : null,
      ...(scenario.note ? { note: scenario.note } : {}),
    })
  }
  printTable({ store, records, fixtureBytes: fixture.length, runs, results })
}

function databaseCases(items) {
  const size = items.length
  const batch = items.slice(0, maxBatchSize)
  const added = batch.map((item, i) => ({ ...item, id: `new-${i}` }))
  const updates = items.map(item => ({ id: item.id, benchmarkUpdated: true }))
  const last = items.at(-1)
  const offset = Math.floor(size / 2)
  const page = [...items].reverse().slice(offset, offset + 20)
  const checkPage = result => {
    assert.equal(result.total, size)
    assert.deepEqual(result.data, page)
  }
  const changed = items.map(item => ({ ...item, benchmarkUpdated: true }))
  const reads = (name, operation, verify) => ({
    name,
    work: `${readCalls} calls`,
    run: db => repeatAsync(readCalls, i => operation(db, i)),
    verify: results => results.forEach(verify),
  })
  return [
    {
      name: 'Open + get()',
      cold: true,
      run: (_db, open) => open().get(),
      verify: result => assert.deepEqual(result, { total: size, data: items }),
    },
    reads(
      'get() cached',
      db => db.get(),
      result => assert.deepEqual(result, { total: size, data: items }),
    ),
    reads(
      'getById() hit',
      (db, i) => db.getById(items[Math.floor((i * size) / readCalls)].id),
      (result, i) => assert.deepEqual(result, items[Math.floor((i * size) / readCalls)]),
    ),
    reads(
      'getById() miss',
      db => db.getById('missing'),
      result => assert.equal(result, undefined),
    ),
    reads('get() sorted page', db => db.get({ orderBy: 'desc', offset, limit: 20 }), checkPage),
    {
      ...reads(
        'Count records *',
        db => (db.count ? db.count() : db.get().then(result => result.total)),
        result => assert.equal(result, size),
      ),
      note: '3.0.1: get().total; current: count().',
    },
    {
      ...reads(
        'Check ID exists *',
        db => (db.hasById ? db.hasById(last.id) : db.getById(last.id).then(Boolean)),
        result => assert.equal(result, true),
      ),
      note: '3.0.1: Boolean(getById()); current: hasById().',
    },
    {
      name: 'read(true)',
      run: db => db.read(true),
      verify: result => assert.deepEqual(result.items, items),
    },
    { name: 'insert()', run: db => db.insert(added[0]), expected: [...items, added[0]] },
    {
      name: 'insertMany()',
      work: `${added.length} records`,
      run: db => db.insertMany(added),
      expected: [...items, ...added],
    },
    {
      name: 'updateById()',
      run: db => db.updateById(last.id, { benchmarkUpdated: true }),
      verify: result => assert.equal(result, true),
      expected: [...items.slice(0, -1), changed.at(-1)],
    },
    {
      name: 'updateMany()',
      work: `${size.toLocaleString('en-US')} records`,
      run: db => db.updateMany(updates),
      verify: result => assert.deepEqual(result, { total: size, success: size }),
      expected: changed,
    },
    { name: 'removeById()', run: db => db.removeById(last.id), expected: items.slice(0, -1) },
    {
      name: 'Remove batch *',
      work: `${batch.length} records`,
      run: db =>
        db.removeMany
          ? db.removeMany(batch.map(item => item.id))
          : repeatAsync(batch.length, i => db.removeById(batch[i].id)),
      expected: items.slice(batch.length),
      note: '3.0.1: sequential removeById(); current: removeMany().',
    },
    {
      name: 'overwrite()',
      work: `${added.length} replacements`,
      run: db => db.overwrite(added),
      expected: added,
    },
  ]
}

function jsonCases(settings) {
  const keys = Object.keys(settings)
  const lastKey = keys.at(-1)
  const values = Object.fromEntries(keys.slice(0, maxBatchSize).map(key => [key, 'updated']))
  const { [lastKey]: _removed, ...remaining } = settings
  return [
    {
      name: 'Open + read()',
      cold: true,
      run: (_db, open) => open().read(),
      verify: result => assert.deepEqual(result, settings),
    },
    {
      name: 'get() cached',
      work: `${readCalls} calls`,
      run: db => repeatSync(readCalls, () => db.get(lastKey)),
      verify: results => results.forEach(result => assert.equal(result, settings[lastKey])),
    },
    {
      name: 'has() cached',
      work: `${readCalls} calls`,
      run: db => repeatSync(readCalls, i => db.has(i % 2 ? lastKey : 'missing')),
      verify: results => results.forEach((result, i) => assert.equal(result, Boolean(i % 2))),
    },
    { name: 'read(true)', run: db => db.read(true), verify: result => assert.deepEqual(result, settings) },
    { name: 'set()', run: db => db.set(lastKey, 'updated'), expected: { ...settings, [lastKey]: 'updated' } },
    {
      name: 'Set batch *',
      work: `${Object.keys(values).length} keys`,
      run: db => {
        if (db.setMany) db.setMany(values)
        else for (const [key, value] of Object.entries(values)) db.set(key, value)
      },
      expected: { ...settings, ...values },
      note: '3.0.1: sequential set(); current: setMany().',
    },
    {
      name: 'unset()',
      run: db => db.unset(lastKey),
      verify: result => assert.equal(result, true),
      expected: remaining,
    },
    { name: 'clear()', run: db => db.clear(), expected: {} },
  ]
}

try {
  if (!jsonOutput) {
    console.log(`Store benchmark | Node ${process.version} | ${process.platform}/${process.arch}`)
    console.log('Lower time is better. Ratios compare total elapsed time for identical work per row.')
    console.log('Setup and verification excluded; open includes construction and first read, not a cold OS cache.')
    console.log(
      `Batch insert/remove/set and replacement sizes are capped at ${maxBatchSize}; updateMany covers all records.`,
    )
    console.log('Sorted pagination uses creation-ordered fixtures so both versions return the same records.')
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
    await compare('DBStore', size, gzipSync(JSON.stringify(data)), databaseCases(items))
    const settings = Object.fromEntries(items.map(item => [`setting-${item.id}`, item.title]))
    await compare('JSONStore', size, Buffer.from(JSON.stringify(settings)), jsonCases(settings))
  }
} finally {
  // Verify the resolved target before deleting only this invocation's temporary fixtures.
  const target = resolve(root)
  assert.equal(dirname(target), resolve(tmpdir()))
  assert.ok(basename(target).startsWith('store-benchmark-'))
  await rm(target, { recursive: true, force: true })
}
