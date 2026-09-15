// Reproduction harness: CONFIRMED means the bug is present, not that the implementation is correct.
// Run npm run repro:bugs to build first. See scripts/README.md for exit codes and case selection.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const scriptPath = fileURLToPath(import.meta.url)
const caseTimeoutMs = 15_000
const cases = new Map()
const fixes = new Map()
let verifyFixed = false
let root
let DBStore
let JSONStore

const metadata = [
  {
    id: '01',
    finding: 1,
    severity: 'P1',
    title: 'Out-of-order compression lets an old snapshot undo a deletion',
    expected: 'After deletion and both writes settle, memory and disk should both be empty.',
    method: 'controlled interleaving',
  },
  {
    id: '02-db',
    finding: 2,
    severity: 'P1',
    title: 'Corrupt binary read is silently accepted and overwritten',
    expected: 'Opening corrupt binary data should reject and preserve the file.',
    method: 'public API',
  },
  {
    id: '02-json',
    finding: 2,
    severity: 'P1',
    title: 'Corrupt JSON is silently accepted and overwritten',
    expected: 'Opening malformed JSON should reject and preserve the file.',
    method: 'public API',
  },
  {
    id: '03-read',
    finding: 3,
    severity: 'P1',
    title: 'Concurrent initial reads return empty data',
    expected: 'Both concurrent reads should return the one saved record.',
    method: 'public API',
  },
  {
    id: '03-write',
    finding: 3,
    severity: 'P1',
    title: 'Write during initial read can replace previously saved records',
    expected: 'A write during initialization should wait for the saved data before mutating it.',
    method: 'controlled interleaving',
  },
  {
    id: '04-db',
    finding: 4,
    severity: 'P1',
    title: 'Two cached DBStore instances lose sequential writes',
    expected: 'Both successful inserts should survive reopening the shared file.',
    method: 'public API',
  },
  {
    id: '04-json',
    finding: 4,
    severity: 'P1',
    title: 'Two JSONStore instances lose sequential writes',
    expected: 'Both successful settings should survive reopening the shared file.',
    method: 'public API',
  },
  {
    id: '05-count',
    finding: 5,
    severity: 'P2',
    title: 'Batch insert discards writable=false',
    expected: 'Three batch inserts should cause one adapter write.',
    method: 'write counter',
  },
  {
    id: '05-partial',
    finding: 5,
    severity: 'P2',
    title: 'Failed overwrite persists a partial replacement',
    expected: 'A failed batch replacement should preserve the original persisted collection.',
    method: 'injected write failure',
  },
  {
    id: '06',
    finding: 6,
    severity: 'P2',
    title: 'Changing an ID corrupts the membership index',
    expected: 'ID changes should be rejected or keep lookup and uniqueness consistent.',
    method: 'public API',
  },
  {
    id: '07',
    finding: 7,
    severity: 'P2',
    title: 'Inherited property IDs are silently dropped',
    expected: 'A toString ID should be saved; updating a missing constructor ID should return false.',
    method: 'public API',
  },
  {
    id: '08',
    finding: 8,
    severity: 'P2',
    title: 'Adding a collection to an existing database throws',
    expected: 'A new collection should initialize without losing existing collections.',
    method: 'public API',
  },
  {
    id: '09',
    finding: 9,
    severity: 'P2',
    title: 'Failed write remains in memory and gets committed by a later success',
    expected: 'A rejected insert should not be committed by an unrelated later insert.',
    method: 'injected write failure',
  },
  {
    id: '10-default',
    finding: 10,
    severity: 'P2',
    title: 'Documented default value is ignored',
    expected: "get('theme', 'light') should return the documented fallback.",
    method: 'public API',
  },
  {
    id: '10-write',
    finding: 10,
    severity: 'P2',
    title: 'Documented JSON write method does not exist',
    expected: 'The documented write() call should be available.',
    method: 'public API',
  },
  {
    id: '11',
    finding: 11,
    severity: 'P2',
    title: 'Creation-time sorting uses insertion order instead',
    expected: 'Ascending timestamps should be [100,200], descending [200,100].',
    method: 'public API',
  },
  {
    id: '12',
    finding: 12,
    severity: 'P2',
    title: 'Bracket-path unset fails despite has/get/set understanding the path',
    expected: "unset('items[0]') should remove the path accepted by set/get/has.",
    method: 'public API',
  },
  {
    id: '13',
    finding: 13,
    severity: 'P2',
    title: 'Array JSON root accepts a property then silently omits it from disk',
    expected: 'Reject an unsupported JSON root or persist every successful setting.',
    method: 'public API',
  },
  {
    id: '14',
    finding: 14,
    severity: 'P2',
    title: 'Upsert resets creation time and returns an incomplete record',
    expected: 'Reinsertion should preserve createdAt and return the merged stored record.',
    method: 'public API',
  },
  {
    id: '15',
    finding: 15,
    severity: 'P3',
    title: 'Batch return metadata differs from the persisted records',
    expected: 'Returned batch updatedAt values should equal the stored values.',
    method: 'test clock',
  },
]

function test(id, run) {
  assert(!cases.has(id), 'Duplicate case ID')
  cases.set(id, run)
}

function verify(id, run) {
  assert(!fixes.has(id), 'Duplicate verification ID')
  fixes.set(id, run)
}

verify('01', async () => {
  const db = await seed('write-order.db', [])
  const adapter = db.getAdapter()
  const compress = adapter.gzipAsync
  let started, release
  const entered = new Promise(resolve => {
    started = resolve
  })
  const gate = new Promise(resolve => {
    release = resolve
  })
  let first = true
  adapter.gzipAsync = async data => {
    if (first) {
      first = false
      started()
      await gate
    }
    return compress(data)
  }
  const inserted = db.insert({ id: 'a' })
  await entered
  const removed = db.removeById('a')
  // Give an unqueued deletion a chance to finish, but always release the first write.
  try {
    await Promise.race([removed, delay(150)])
  } finally {
    release()
  }
  await Promise.all([inserted, removed])
  assert.equal((await db.get()).total, 0)
  assert.equal((await new DBStore(file('write-order.db'), 'items').get()).total, 0)
  return { memoryCount: 0, persistedCount: 0 }
})

const file = name => join(root, name)
const seed = async (name, data = [{ id: 'saved', value: 1 }]) => {
  const db = new DBStore(file(name), 'items')
  await db.insertMany(data)
  return db
}

// Corrupt fixtures are synthetic, but parser diagnostics can contain file contents.
// Suppress those diagnostics rather than copying them to the terminal or report.
const quiet = async fn => {
  const original = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = original
  }
}

// Cases assert the previously observed faulty behavior. Timing gates only delay real
// adapter operations; they do not edit snapshots or fake filesystem results.
// Each case runs in its own bounded child process, isolating mocks and stalled gates.

test('03-read', async () => {
  await seed('read-race.db')
  const db = new DBStore(file('read-race.db'), 'items')
  const out = await Promise.all([db.get(), db.get()])
  assert.deepEqual(
    out.map(x => x.total),
    [1, 0],
  )
  return { totals: out.map(x => x.total) }
})

test('05-count', async () => {
  const db = await seed('batch.db', [])
  const adapter = db.getAdapter()
  const orig = adapter.write.bind(adapter)
  let writes = 0
  adapter.write = async data => {
    writes++
    return orig(data)
  }
  await db.insertMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  assert.equal(writes, 4)
  return { items: 3, writes, expectedWrites: 1 }
})

test('02-db', async () => {
  const p = file('bad.db')
  const original = Buffer.from('synthetic-invalid-gzip')
  await writeFile(p, original)
  const db = new DBStore(p, 'items')
  const total = await quiet(async () => (await db.get()).total)
  await db.insert({ id: 'new' })
  assert.equal(total, 0)
  assert.notDeepEqual(await readFile(p), original)
  return { readReturned: total, readRejected: false, originalBytesOverwritten: true, errorCount: db.errorList.length }
})

test('02-json', async () => {
  const p = file('bad.json')
  await writeFile(p, '{"saved":1,')
  let db
  await quiet(async () => {
    db = new JSONStore(p)
  })
  db.set('new', 2)
  const saved = JSON.parse(await readFile(p, 'utf8'))
  assert.deepEqual(saved, { new: 2 })
  return { readRejected: false, savedKeys: Object.keys(saved) }
})

test('06', async () => {
  const db = await seed('id-change.db', [{ id: 'a', value: 1 }])
  const renamed = await db.updateById('a', { id: 'b' })
  const updateNew = await db.updateById('b', { value: 2 })
  const updateOld = await db.updateById('a', { value: 3 })
  await db.insert({ id: 'b', value: 4 })
  const ids = (await db.get()).data.map(x => x.id)
  assert.equal(renamed, true)
  assert.equal(updateNew, false)
  assert.equal(updateOld, true)
  assert.deepEqual(ids, ['b', 'b'])
  return { updateNew, updateOld, ids }
})

test('07', async () => {
  const db = await seed('special-id.db', [])
  const out = await db.insert({ id: 'toString', value: 1 })
  const total = (await db.get()).total
  const success = await db.updateById('constructor', { value: 2 })
  assert.equal(out.id, 'toString')
  assert.equal(total, 0)
  assert.equal(success, true)
  return { returnedId: out.id, storedCount: total, updateMissingConstructor: success }
})

test('08', async () => {
  const p = file('collections.db')
  await new DBStore(p, 'users').insert({ id: 'a' })
  let message = ''
  try {
    await new DBStore(p, 'images').get()
  } catch (e) {
    message = e.message
  }
  assert.match(message, /slice/)
  return { error: message }
})

test('04-db', async () => {
  const first = await seed('instances.db', [])
  const second = new DBStore(file('instances.db'), 'items')
  await second.read()
  await first.insert({ id: 'a' })
  await second.insert({ id: 'b' })
  const ids = (await new DBStore(file('instances.db'), 'items').get()).data.map(x => x.id)
  assert.deepEqual(ids, ['b'])
  return { successfulInsertIds: ['a', 'b'], persistedIds: ids }
})

test('04-json', async () => {
  const p = file('instances.json')
  const first = new JSONStore(p)
  const second = new JSONStore(p)
  first.set('a', 1)
  second.set('b', 2)
  const saved = new JSONStore(p).read()
  assert.deepEqual(saved, { b: 2 })
  return { savedKeys: Object.keys(saved) }
})

test('10-write', async () => {
  const db = new JSONStore(file('api.json'))
  assert.equal(typeof db.write, 'undefined')
  assert.throws(() => db.write(), TypeError)
  return { error: 'TypeError: db.write is not a function' }
})

test('10-default', async () => {
  const db = new JSONStore(file('api-default.json'))
  const value = db.get('theme', 'light')
  assert.equal(value, undefined)
  return { expected: 'light', actual: String(value) }
})

test('11', async () => {
  const db = await seed('sort.db', [
    { id: 'newer', createdAt: 200 },
    { id: 'older', createdAt: 100 },
  ])
  const asc = (await db.get({ orderBy: 'asc' })).data.map(x => x.createdAt)
  const desc = (await db.get({ orderBy: 'desc' })).data.map(x => x.createdAt)
  assert.deepEqual(asc, [200, 100])
  assert.deepEqual(desc, [100, 200])
  return { asc, desc }
})

test('12', async () => {
  const db = new JSONStore(file('unset.json'))
  db.set('items[0]', { value: 1 })
  assert.equal(db.has('items[0]'), true)
  const result = db.unset('items[0]')
  assert.equal(result, false)
  assert.equal(db.has('items[0]'), true)
  return { unsetResult: result, itemStillPresent: true }
})

test('15', async () => {
  const db = await seed('batch-meta.db', [])
  const original = Date.now
  let t = 100
  Date.now = () => ++t
  let returned
  try {
    returned = await db.insertMany([{ id: 'a' }, { id: 'b' }])
  } finally {
    Date.now = original
  }
  const stored = (await db.get()).data
  assert.deepEqual(
    returned.map(item => item.id),
    stored.map(item => item.id),
  )
  assert.notDeepEqual(
    returned.map(item => item.updatedAt),
    stored.map(item => item.updatedAt),
  )
  return { returnedTimestamps: returned.map(x => x.updatedAt), storedTimestamps: stored.map(x => x.updatedAt) }
})

test('09', async () => {
  const db = await seed('failed-write.db', [])
  const adapter = db.getAdapter()
  const orig = adapter.write.bind(adapter)
  adapter.write = async () => {
    throw new Error('synthetic write failure')
  }
  await assert.rejects(db.insert({ id: 'failed' }), /synthetic/)
  adapter.write = orig
  await db.insert({ id: 'ok' })
  const ids = (await new DBStore(file('failed-write.db'), 'items').get()).data.map(x => x.id)
  assert.deepEqual(ids, ['failed', 'ok'])
  return { rejectedInsertId: 'failed', persistedIds: ids }
})

test('01', async () => {
  const db = await seed('write-race.db', [])
  const adapter = db.getAdapter()
  const orig = adapter.gzipAsync
  let markStarted, release
  const started = new Promise(resolve => {
    markStarted = resolve
  })
  const gate = new Promise(resolve => {
    release = resolve
  })
  let first = true
  adapter.gzipAsync = async data => {
    if (first) {
      first = false
      markStarted()
      await gate
    }
    return orig(data)
  }
  const insert = db.insert({ id: 'a' })
  await started
  await db.removeById('a')
  release()
  await insert
  const memory = (await db.get()).data.map(x => x.id)
  const disk = (await new DBStore(file('write-race.db'), 'items').get()).data.map(x => x.id)
  assert.deepEqual(memory, [])
  assert.deepEqual(disk, ['a'])
  return { schedule: 'First compression paused until deletion finishes', memoryIds: memory, persistedIds: disk }
})

test('13', async () => {
  const p = file('array.json')
  await writeFile(p, '[]')
  const db = new JSONStore(p)
  db.set('theme', 'dark')
  assert.equal(db.get('theme'), 'dark')
  const restored = new JSONStore(p).get('theme')
  assert.equal(restored, undefined)
  return { immediateValue: 'dark', reopenedValue: String(restored) }
})

test('14', async () => {
  const db = await seed('upsert.db', [{ id: 'a', createdAt: 1, oldField: 'kept' }])
  const result = await db.insert({ id: 'a', value: 2 })
  const stored = await db.getById('a')
  assert.notEqual(stored.createdAt, 1)
  assert.equal('oldField' in result, false)
  assert.equal(stored.oldField, 'kept')
  return { originalCreatedAt: 1, creationTimeReset: true, returnedOldFieldPresent: false, storedOldFieldPresent: true }
})

test('05-partial', async () => {
  const db = await seed('partial-overwrite.db', [{ id: 'original' }])
  const adapter = db.getAdapter()
  const orig = adapter.write.bind(adapter)
  let writes = 0
  adapter.write = async data => {
    if (++writes === 2) throw new Error('synthetic second-write failure')
    return orig(data)
  }
  await assert.rejects(db.overwrite([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), /synthetic/)
  const ids = (await new DBStore(file('partial-overwrite.db'), 'items').get()).data.map(x => x.id)
  assert.deepEqual(ids, ['a'])
  return { overwriteRejected: true, persistedIds: ids }
})

test('03-write', async () => {
  await seed('startup-write.db', [{ id: 'saved' }])
  const db = new DBStore(file('startup-write.db'), 'items')
  const adapter = db.getAdapter()
  const orig = adapter.read.bind(adapter)
  let notifyRead, release
  const captured = new Promise(r => {
    notifyRead = r
  })
  const gate = new Promise(r => {
    release = r
  })
  adapter.read = async () => {
    const data = await orig()
    notifyRead()
    await gate
    return data
  }
  const initialRead = db.read()
  await captured
  await db.insert({ id: 'new' })
  release()
  await initialRead
  const memory = (await db.get()).data.map(x => x.id)
  const disk = (await new DBStore(file('startup-write.db'), 'items').get()).data.map(x => x.id)
  assert.deepEqual(memory, ['saved'])
  assert.deepEqual(disk, ['new'])
  return { schedule: 'Initial read held before publishing loaded data', memoryIds: memory, persistedIds: disk }
})

verify('02-db', async () => {
  const p = file('corrupt.db')
  const invalid = Buffer.from('synthetic-invalid-gzip')
  await writeFile(p, invalid)
  const db = new DBStore(p, 'items')
  await assert.rejects(db.get())
  await assert.rejects(db.insert({ id: 'new' }))
  assert.deepEqual(await readFile(p), invalid)
  // Repairing the file allows the same object to retry its failed initialization.
  await seed('repair.db', [{ id: 'saved' }])
  await writeFile(p, await readFile(file('repair.db')))
  assert.equal((await db.get()).total, 1)
  return { corruptFilePreserved: true, writesRejected: true, recoverySucceeded: true }
})
verify('02-json', async () => {
  const p = file('corrupt.json')
  const invalid = '{"saved":1,'
  await writeFile(p, invalid)
  assert.throws(() => new JSONStore(p), /Invalid JSON store/)
  assert.equal(await readFile(p, 'utf8'), invalid)
  const db = new JSONStore(file('refresh.json'))
  db.set('saved', 1)
  await writeFile(file('refresh.json'), invalid)
  assert.throws(() => db.read(true), /Invalid JSON store/)
  assert.throws(() => db.set('new', 2), /Invalid JSON store/)
  assert.equal(await readFile(file('refresh.json'), 'utf8'), invalid)
  return { parseRejected: true, corruptFilePreserved: true }
})

verify('03-read', async () => {
  await seed('initial.db')
  const db = new DBStore(file('initial.db'), 'items')
  const results = await Promise.all([db.get(), db.get(), db.get()])
  assert.deepEqual(
    results.map(result => result.total),
    [1, 1, 1],
  )
  assert.equal(db.getAdapter().readCount, 1)
  await db.read(true)
  assert.equal(db.getAdapter().readCount, 2)
  return { totals: results.map(result => result.total), initialLoads: 1 }
})
verify('03-write', async () => {
  await seed('initial-write.db', [{ id: 'saved' }])
  const db = new DBStore(file('initial-write.db'), 'items')
  const adapter = db.getAdapter()
  const read = adapter.read.bind(adapter)
  let entered, release
  const started = new Promise(resolve => {
    entered = resolve
  })
  const gate = new Promise(resolve => {
    release = resolve
  })
  adapter.read = async () => {
    const result = await read()
    entered()
    await gate
    return result
  }
  const loading = db.read()
  await started
  let settled = false
  const inserting = db.insert({ id: 'new' }).finally(() => {
    settled = true
  })
  try {
    await delay(30)
    assert.equal(settled, false)
  } finally {
    release()
  }
  await Promise.all([loading, inserting])
  const ids = (await new DBStore(file('initial-write.db'), 'items').get()).data.map(item => item.id)
  assert.deepEqual(ids, ['saved', 'new'])
  return { waitedForInitialization: true, persistedIds: ids }
})

verify('05-count', async () => {
  const db = await seed('batch-count.db', [{ id: 'existing', value: 0 }])
  const adapter = db.getAdapter()
  const write = adapter.write.bind(adapter)
  let writes = 0
  adapter.write = async data => {
    writes++
    return write(data)
  }
  await db.insertMany([{ id: 'existing', value: 1 }, { id: 'b' }, { id: 'c' }])
  assert.equal(writes, 1)
  const reopened = await new DBStore(file('batch-count.db'), 'items').get()
  assert.equal(reopened.total, 3)
  assert.equal(reopened.data.find(item => item.id === 'existing').value, 1)
  return { items: 3, writes }
})
verify('05-partial', async () => {
  const db = await seed('batch-rollback.db', [{ id: 'original' }])
  const before = await readFile(file('batch-rollback.db'))
  const adapter = db.getAdapter()
  const write = adapter.write.bind(adapter)
  let writes = 0
  adapter.write = async () => {
    writes++
    throw new Error('synthetic commit failure')
  }
  await assert.rejects(db.overwrite([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), /synthetic/)
  assert.equal(writes, 1)
  assert.deepEqual(await readFile(file('batch-rollback.db')), before)
  adapter.write = write
  await db.overwrite([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
  assert.equal((await new DBStore(file('batch-rollback.db'), 'items').get()).total, 3)
  return { failedBatchWrites: writes, originalFilePreservedOnFailure: true, retryCount: 3 }
})

verify('06', async () => {
  const db = await seed('immutable-id.db', [{ id: 'a', value: 1 }])
  await assert.rejects(db.updateById('a', { id: 'b' }), /IDs cannot be changed/)
  assert.equal(await db.updateById('a', { value: 2 }), true)
  assert.equal(await db.updateById('missing', { value: 3 }), false)
  await db.updateById('a', { id: undefined, value: 4 })
  assert.equal((await db.getById('a')).value, 4)
  await db.insert({ id: 'b' })
  assert.deepEqual(
    (await db.get()).data.map(item => item.id),
    ['a', 'b'],
  )
  assert.deepEqual(await db.updateMany([{ id: 'a', value: 5 }, { id: 'missing' }]), { total: 2, success: 1 })
  return { renameRejected: true, originalIdUsable: true, uniqueIds: ['a', 'b'] }
})

verify('07', async () => {
  const db = await seed('special-ids.db', [])
  assert.equal(await db.updateById('constructor', { value: 1 }), false)
  const ids = ['toString', 'constructor', '__proto__', 'hasOwnProperty']
  await db.insertMany(ids.map(id => ({ id, value: 1 })))
  const reopened = new DBStore(file('special-ids.db'), 'items')
  assert.equal((await reopened.get()).total, ids.length)
  for (const id of ids) {
    assert.equal(await reopened.updateById(id, { value: 2 }), true)
    assert.equal((await reopened.getById(id)).value, 2)
  }
  await reopened.removeById('__proto__')
  assert.equal(await reopened.getById('__proto__'), undefined)
  return { persistedSpecialIds: ids, missingUpdateReturned: false }
})

async function runWorker(id, parentRoot) {
  const run = (verifyFixed ? fixes : cases).get(id)
  assert(run, 'Unknown worker case ID')
  root = await mkdtemp(join(parentRoot, id + '-'))
  // Loading in the worker keeps --help and --list usable before the first build.
  ;({ DBStore, JSONStore } = await import('../dist/index.js'))
  try {
    const observed = await quiet(run)
    process.stdout.write(JSON.stringify({ status: verifyFixed ? 'FIXED' : 'CONFIRMED', observed, fixtures: root }))
  } catch (error) {
    // Never forward arbitrary library diagnostics or file contents.
    process.stdout.write(
      JSON.stringify({
        status: error instanceof assert.AssertionError ? 'NOT CONFIRMED' : 'ERROR',
        reason:
          error instanceof assert.AssertionError
            ? 'The observed behavior did not match the asserted bug signature.'
            : 'The case threw before it could confirm the bug.',
        errorType: error.name,
        errorCode: error.code,
        fixtures: root,
      }),
    )
  }
}

async function runIsolated(meta, parentRoot) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, '--worker', meta.id, parentRoot, ...(verifyFixed ? ['--verify-fixed'] : [])],
      {
        timeout: caseTimeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    )
    const result = JSON.parse(stdout)
    assert(['FIXED', 'CONFIRMED', 'NOT CONFIRMED', 'ERROR'].includes(result.status), 'Invalid worker result')
    return { ...meta, ...result }
  } catch (error) {
    return {
      ...meta,
      status: 'ERROR',
      reason: error.killed
        ? 'Case exceeded 15 seconds. A changed locking implementation may prevent this schedule.'
        : 'Worker failed before returning a result. Ensure npm run build succeeds.',
      errorType: error.name,
    }
  }
}

function help() {
  console.log('Add --verify-fixed to assert correct behavior after fixes.')
  console.log('Usage: npm run repro:bugs [-- --case <finding number or exact case ID>]')
  console.log('       node scripts/reproduce-bugs.mjs --list')
  console.log('CONFIRMED means the bug is present. Exit 0: all selected bugs confirmed; 1: not confirmed; 2: error.')
  console.log('Each run preserves fresh synthetic fixtures and results.json in a new system temporary directory.')
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    help()
    return
  }
  if (args.length === 1 && args[0] === '--list') {
    for (const meta of metadata) {
      console.log(meta.id + ' | finding ' + meta.finding + ' | ' + meta.severity + ' | ' + meta.title)
    }
    return
  }
  let selected = metadata
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--case') {
      help()
      process.exitCode = 2
      return
    }
    selected = metadata.filter(meta => meta.id === args[1] || String(meta.finding) === args[1])
    if (!selected.length) {
      console.error('No matching case. Use --list to see valid IDs.')
      process.exitCode = 2
      return
    }
  }

  const outputRoot = await mkdtemp(join(tmpdir(), 'piclist-store-repro-'))
  const results = []
  console.log(
    verifyFixed
      ? 'FIXED requires assertions of the expected correct behavior.'
      : 'CONFIRMED means the faulty behavior was reproduced; this is not a regression pass.',
  )
  for (const meta of selected) {
    const result = await runIsolated(meta, outputRoot)
    results.push(result)
    console.log('\n[' + result.status + '] ' + meta.id + ' | ' + meta.severity + ' | ' + meta.title)
    console.log('  Method: ' + meta.method)
    console.log('  Expected: ' + meta.expected)
    console.log('  Observed: ' + (result.observed ? JSON.stringify(result.observed) : result.reason))
  }

  const confirmed = results.filter(result => result.status === (verifyFixed ? 'FIXED' : 'CONFIRMED')).length
  const errors = results.filter(result => result.status === 'ERROR').length
  const summary = {
    confirmed,
    notConfirmed: results.length - confirmed - errors,
    errors,
    total: results.length,
    findingsCovered: new Set(results.map(result => result.finding)).size,
  }
  const reportPath = join(outputRoot, 'results.json')
  await writeFile(reportPath, JSON.stringify({ nodeVersion: process.version, summary, results }, null, 2) + '\n')
  console.log(
    '\n' +
      confirmed +
      '/' +
      results.length +
      (verifyFixed ? ' cases verified fixed across ' : ' cases confirmed across ') +
      summary.findingsCovered +
      ' findings.',
  )
  console.log('Not confirmed: ' + summary.notConfirmed + '; errors: ' + summary.errors)
  console.log('Fixtures and JSON report: ' + reportPath)
  process.exitCode = errors ? 2 : summary.notConfirmed ? 1 : 0
}

try {
  const input = process.argv.slice(2)
  verifyFixed = input.includes('--verify-fixed')
  const args = input.filter(arg => arg !== '--verify-fixed')
  if (args.length === 3 && args[0] === '--worker') {
    await runWorker(args[1], args[2])
  } else {
    await main(args)
  }
} catch (_error) {
  console.error('Reproduction harness could not start. Check the build and temporary-directory access.')
  process.exitCode = 2
}
