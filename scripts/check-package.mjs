import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { npmCommand } from './npm-command.mjs'

const root = await mkdtemp(join(tmpdir(), 'store-package-'))
const project = fileURLToPath(new URL('../', import.meta.url))
const [packed] = JSON.parse(
  npmCommand(['pack', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: project }),
)
const allowed = new Set(['package.json', 'README.md', 'CHANGELOG.md', 'License'])
assert.ok(packed.files.every(file => file.path.startsWith('dist/') || allowed.has(file.path)))
assert.ok(packed.files.some(file => file.path === 'dist/index.js'))
assert.ok(packed.files.some(file => file.path === 'dist/index.d.ts'))

const consumer = join(root, 'consumer')
await mkdir(consumer)
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
npmCommand(
  ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(root, packed.filename)],
  { cwd: consumer },
)
const manifest = JSON.parse(await readFile(join(consumer, 'node_modules/@piclist/store/package.json'), 'utf8'))
assert.equal(manifest.exports['.'].types, './dist/index.d.ts')
await writeFile(
  join(consumer, 'smoke.mjs'),
  `import assert from 'node:assert/strict'
import { DBStore, JSONStore, StoreError } from '@piclist/store'
const db = new DBStore('smoke.db', 'items')
await db.insert({ id: 'a', enabled: true })
assert.equal(await db.count(), 1)
assert.equal((await new DBStore('smoke.db', 'items').getById('a')).enabled, true)
const config = new JSONStore('smoke.json')
config.setMany({ enabled: true, 'nested.items[0]': 'a' })
assert.equal(new JSONStore('smoke.json').get('nested.items[0]'), 'a')
assert.equal(new StoreError('INVALID_RECORD', 'example').code, 'INVALID_RECORD')
`,
)
execFileSync(process.execPath, [join(consumer, 'smoke.mjs')], { cwd: consumer, stdio: 'pipe', windowsHide: true })
await copyFile(join(project, 'tests/types/consumer.ts'), join(consumer, 'consumer.ts'))
const tsc = fileURLToPath(import.meta.resolve('typescript/bin/tsc'))
for (const [module, resolution] of [
  ['nodenext', 'nodenext'],
  ['esnext', 'bundler'],
]) {
  execFileSync(
    process.execPath,
    [
      tsc,
      '--ignoreConfig',
      '--noEmit',
      '--strict',
      '--target',
      'es2022',
      '--module',
      module,
      '--moduleResolution',
      resolution,
      'consumer.ts',
    ],
    { cwd: consumer, stdio: 'pipe', windowsHide: true },
  )
}
console.log('Packed package passed isolated runtime and NodeNext/Bundler type checks.')
console.log(
  JSON.stringify({ files: packed.files.length, packedBytes: packed.size, unpackedBytes: packed.unpackedSize }),
)
