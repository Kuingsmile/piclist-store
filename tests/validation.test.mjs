import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DBStore, StoreError } from '../dist/index.js'

test('invalid records and serialized IDs never damage committed data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-validation-'))
  const path = join(root, 'data.db')
  const db = new DBStore(path, 'items')
  await db.insert({ id: 'existing' })
  const before = await readFile(path)
  for (const value of [{ id: 123 }, { id: null }, 1, null, ['array']]) {
    await assert.rejects(db.insert(value), error => error instanceof StoreError && error.code === 'INVALID_RECORD')
    assert.ok(before.equals(await readFile(path)))
  }
  await assert.rejects(db.insert({ id: 'valid', toJSON: () => ({ id: 42 }) }), { code: 'INVALID_STORE' })
  await assert.rejects(db.insertMany([{ id: 'new' }, { id: 42 }]), { code: 'INVALID_RECORD' })
  await assert.rejects(db.updateById('existing', { id: 42 }), { code: 'INVALID_RECORD' })
  assert.ok(before.equals(await readFile(path)))
  assert.equal((await new DBStore(path, 'items').get()).total, 1)
})
