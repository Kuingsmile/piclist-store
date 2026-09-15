import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DBStore, JSONStore } from '../dist/index.js'

test('removeMany commits once, preserves order, and rolls back failed writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-batch-'))
  const path = join(root, 'data.db')
  const db = new DBStore(path, 'items')
  await db.insertMany(['a', 'b', 'c', '__proto__'].map(id => ({ id })))
  const adapter = db.getAdapter()
  const write = adapter.write.bind(adapter)
  let writes = 0
  adapter.write = async data => {
    writes++
    await write(data)
  }
  assert.equal(await db.count(), 4)
  assert.equal(await db.hasById('a'), true)
  assert.equal(await db.hasById('missing'), false)
  assert.deepEqual(await db.removeMany(['b', 'b', 'missing', '__proto__']), { total: 4, success: 2 })
  assert.equal(writes, 1)
  assert.deepEqual(
    (await new DBStore(path, 'items').get()).data.map(item => item.id),
    ['a', 'c'],
  )
  assert.equal(await db.hasById('b'), false)
  assert.deepEqual(await db.removeMany([]), { total: 0, success: 0 })
  assert.equal(writes, 1)
  const before = await readFile(path)
  adapter.write = async () => {
    throw new Error('synthetic write failure')
  }
  await assert.rejects(db.removeMany(['a', 'c']), /synthetic/)
  assert.equal(await db.count(), 2)
  assert.ok(before.equals(await readFile(path)))
  adapter.write = write
  await db.insert({ id: 'd' })
  assert.equal(await new DBStore(path, 'items').count(), 3)
})

test('setMany keeps comments and paths, commits once, and restores failed batches', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-config-batch-'))
  const path = join(root, 'config.json')
  await writeFile(path, '{\n // retained comment\n "original": true\n}')
  const config = new JSONStore(path)
  const adapter = config.db.adapter
  const write = adapter.write.bind(adapter)
  let writes = 0
  adapter.write = data => {
    writes++
    write(data)
  }
  config.setMany({ 'ui.theme': 'dark', 'items[0]': 'first', enabled: false })
  assert.equal(writes, 1)
  assert.equal(new JSONStore(path).get('items[0]'), 'first')
  assert.ok((await readFile(path, 'utf8')).includes('// retained comment'))
  config.setMany({})
  assert.equal(writes, 1)
  const before = await readFile(path)
  adapter.write = () => {
    throw new Error('synthetic write failure')
  }
  assert.throws(() => config.setMany({ 'ui.theme': 'light', extra: 1 }), /synthetic/)
  assert.equal(config.get('ui.theme'), 'dark')
  assert.equal(config.has('extra'), false)
  assert.ok(before.equals(await readFile(path)))
})
