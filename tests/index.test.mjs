import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DBStore } from '../dist/index.js'

test('batch lookup follows repeated upserts, replacement, and refreshed records', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-index-'))
  const path = join(root, 'data.db')
  const db = new DBStore(path, 'items')
  await db.insertMany([{ id: 'a', retained: true }, { id: 'b' }, { id: 'a', value: 1 }])
  assert.deepEqual(
    await db.updateMany([
      { id: 'a', value: 2 },
      { id: 'a', value: 3 },
    ]),
    { total: 2, success: 2 },
  )
  assert.equal((await db.getById('a')).value, 3)
  assert.equal((await db.getById('a')).retained, true)
  await db.overwrite([{ id: 'a', value: 4 }, { id: 'b' }])
  assert.equal((await db.getById('a')).retained, undefined)
  await new DBStore(path, 'items').updateById('a', { value: 5 })
  await db.updateMany([{ id: 'a', extra: true }])
  assert.equal((await db.getById('a')).value, 5)
  const live = await db.getById('a')
  live.id = 'changed-in-memory'
  assert.equal(await db.getById('a'), undefined)
  assert.equal(await db.getById('changed-in-memory'), live)
})
