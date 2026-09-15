import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DBStore, JSONStore } from '../dist/index.js'

test('explicit refresh updates cached readers without changing the default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'store-refresh-'))
  const path = join(root, 'data.db')
  const writer = new DBStore(path, 'items')
  const reader = new DBStore(path, 'items')
  await writer.insert({ id: 'first' })
  assert.equal(await reader.count(), 1)
  await writer.insert({ id: 'second' })
  assert.equal(await reader.count(), 1)
  await reader.refresh()
  assert.equal(await reader.count(), 2)
  const configPath = join(root, 'config.json')
  const configWriter = new JSONStore(configPath)
  configWriter.set('theme', 'light')
  const configReader = new JSONStore(configPath)
  configWriter.set('theme', 'dark')
  assert.equal(configReader.get('theme'), 'light')
  assert.equal(configReader.refresh().theme, 'dark')
  const valid = await readFile(configPath)
  await writeFile(configPath, '{invalid')
  assert.throws(() => configReader.refresh(), { code: 'INVALID_STORE' })
  await writeFile(configPath, valid)
  assert.equal(configReader.refresh().theme, 'dark')
})
