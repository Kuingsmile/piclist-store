// Never print fixture contents or assertion values: optional inputs may contain credentials.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { gunzipSync } from 'node:zlib'

import { DBStore as LegacyDBStore, JSONStore as LegacyJSONStore } from 'store-legacy'

import { DBStore, JSONStore } from '../dist/index.js'

const root = await mkdtemp(join(tmpdir(), 'piclist-store-compat-'))
const originalConsoleError = console.error
// The released adapter logs parser diagnostics, which can expose private contents.
console.error = () => {}
let phase = 'arguments'
let completed = 0

function equal(actual, expected) {
  assert.ok(isDeepStrictEqual(actual, expected), 'Compatibility mismatch')
}

function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

async function check(name, run) {
  phase = name
  await run()
  completed++
  console.log('PASS ' + name)
}

async function records(Store, path, collection) {
  const db = new Store(path, collection)
  const result = await db.get()
  assert.equal(db.errorList.length, 0)
  return result
}

async function databaseRoundtrip(Writer, Reader, filename) {
  const path = join(root, filename)
  const writer = new Writer(path, 'images')
  const first = await writer.insert({ id: 'compat-a', title: '图片', tags: ['a'], nested: { enabled: true } })
  await writer.insert({ id: 'compat-b', title: 'second' })
  equal(await new Reader(path, 'images').getById(first.id), first)
  equal((await records(Reader, path, 'images')).total, 2)
  const reader = new Reader(path, 'images')
  equal(await reader.updateById(first.id, { title: 'changed' }), true)
  equal((await new Writer(path, 'images').getById(first.id)).title, 'changed')
  await reader.removeById('compat-b')
  equal((await records(Writer, path, 'images')).total, 1)
  equal([...(await readFile(path)).subarray(0, 2)], [0x1f, 0x8b])
}

async function jsonRoundtrip(Writer, Reader, filename) {
  const path = join(root, filename)
  await writeFile(path, '{\n  // compatibility comment\n  "theme": "light"\n}\n')
  const writer = new Writer(path)
  writer.set('nested.values', [true, null, '图片', 42])
  const reader = new Reader(path)
  equal(plain(reader.get('nested.values')), [true, null, '图片', 42])
  reader.set('theme', 'dark')
  equal(new Writer(path).get('theme'), 'dark')
  assert.ok((await readFile(path, 'utf8')).includes('// compatibility comment'))
}

async function privateCopy(source, filename, run) {
  const before = await readFile(source)
  const path = join(root, filename)
  try {
    await copyFile(source, path)
    await run(path, before)
  } finally {
    await unlink(path).catch(() => {})
    assert.ok(before.equals(await readFile(source)), 'Original fixture changed')
  }
}

try {
  const args = process.argv.slice(2)
  const inputs = new Map()
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(['--json', '--db'].includes(args[i]) && args[i + 1] && !inputs.has(args[i]))
    inputs.set(args[i], args[i + 1])
  }
  await check('3.0.1 database -> current -> 3.0.1', () => databaseRoundtrip(LegacyDBStore, DBStore, 'old.db'))
  await check('current database -> 3.0.1 -> current', () => databaseRoundtrip(DBStore, LegacyDBStore, 'new.db'))
  await check('3.0.1 JSON -> current -> 3.0.1', () => jsonRoundtrip(LegacyJSONStore, JSONStore, 'old.json'))
  await check('current JSON -> 3.0.1 -> current', () => jsonRoundtrip(JSONStore, LegacyJSONStore, 'new.json'))

  if (inputs.has('--json')) {
    await check('provided JSON: bidirectional read/write, original unchanged', () =>
      privateCopy(inputs.get('--json'), 'private.json', async path => {
        const baseline = plain(new LegacyJSONStore(path).read())
        const current = new JSONStore(path)
        equal(plain(current.read()), baseline)
        const key = 'compat-' + randomUUID()
        current.set(key, { enabled: true, values: [1, null, 'synthetic'] })
        const legacy = new LegacyJSONStore(path)
        equal(plain(legacy.get(key)), { enabled: true, values: [1, null, 'synthetic'] })
        legacy.unset(key)
        equal(plain(new JSONStore(path).read()), baseline)
      }),
    )
  }
  if (inputs.has('--db')) {
    await check('provided database: all collections roundtrip, original unchanged', () =>
      privateCopy(inputs.get('--db'), 'private.db', async (path, before) => {
        const data = JSON.parse(gunzipSync(before).toString('utf8'))
        const collections = Object.keys(data).filter(key => Array.isArray(data[key]))
        assert.ok(collections.length > 0)
        for (const collection of collections) {
          const baseline = await records(LegacyDBStore, path, collection)
          equal(await records(DBStore, path, collection), baseline)
          const current = new DBStore(path, collection)
          const inserted = await current.insert({ id: randomUUID(), compatibilityProbe: true })
          const legacy = new LegacyDBStore(path, collection)
          equal(await legacy.getById(inserted.id), inserted)
          await legacy.removeById(inserted.id)
          equal(await records(DBStore, path, collection), baseline)
        }
        const final = JSON.parse(gunzipSync(await readFile(path)).toString('utf8'))
        for (const collection of collections) equal(final[collection], data[collection])
      }),
    )
  }
  console.log('Compatibility checks passed: ' + completed)
} catch {
  originalConsoleError('Compatibility check failed during: ' + phase + '. Fixture contents suppressed.')
  process.exitCode = 1
} finally {
  console.error = originalConsoleError
}
