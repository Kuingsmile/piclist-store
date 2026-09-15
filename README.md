# @piclist/store

[![npm version](https://badge.fury.io/js/@piclist%2Fstore.svg)](https://badge.fury.io/js/@piclist%2Fstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A simple and efficient key-value store for PicList, supporting both JSON and binary data storage with built-in
compression and metadata management.

## ✨ Features

- 🗄️ **Dual Storage Options**: JSON-based and binary database storage
- 🔍 **Query Interface**: ID lookup, creation-time sorting, pagination, and counts
- 📦 **Built-in Compression**: Zlib adapter for efficient storage
- 🎯 **TypeScript Support**: Full type definitions included
- ⚡ **Async/Await**: Promise-based DBStore and synchronous JSONStore
- 🔄 **Batch Operations**: Insert, update, and remove multiple items
- 📝 **Auto Metadata**: Automatic timestamps and unique ID generation

## 📦 Installation

Requires Node.js `^22.13.0 || >=24.0.0` (minimum: **22.13.0**; Node.js 23 is excluded).

```bash
npm install @piclist/store
```

Dependency updates retain `write-file-atomic` 7.x for this Node.js range, TypeScript 6.0.x for the supported
`typescript-eslint` compiler API, and `rollup-plugin-dts` 6.4.x because 6.5.x pulls in Babel 8 with a higher Node.js
minimum. Node.js type definitions follow the supported Node.js 22 major.

## 🚀 Quick Start

### DBStore (Binary Database)

Store local structured collections in a gzip-compressed JSON file. The database is loaded into memory, and each mutation
rewrites the whole file. Prefer batch methods for large updates and measure performance with your workload.

```typescript
import { DBStore } from '@piclist/store'

// Initialize database with collection
const db = new DBStore('data.db', 'images')

// Insert a single item
const result = await db.insert({
  imgUrl: 'https://example.com/image.jpg',
  tags: ['nature', 'landscape'],
  size: 1024,
})

console.log(result)
// {
//   id: 'unique-uuid',
//   imgUrl: 'https://example.com/image.jpg',
//   tags: ['nature', 'landscape'],
//   size: 1024,
//   createdAt: 1671234567890,
//   updatedAt: 1671234567890
// }
```

### JSONStore (JSON Configuration)

Ideal for configuration files and simple key-value storage.

```typescript
import { JSONStore } from '@piclist/store'

// Initialize JSON store
const config = new JSONStore('config.json')

// Set configuration values
config.set('theme', 'dark')
config.set('language', 'en')
// Each set() call persists immediately. Use setMany() to commit several settings once.

// Get configuration
const theme = config.get('theme') // 'dark'
```

## 📚 API Reference

### DBStore

The main database class providing collection-based document storage.

#### Constructor

```typescript
new DBStore(dbPath: string, collectionName: string)
```

- `dbPath`: Path to the database file
- `collectionName`: Name of the collection within the database

#### Methods

##### `.get(filter?: IFilter): Promise<IGetResult<T>>`

Retrieve items from the collection with optional filtering.

```typescript
// Get all items
const all = await db.get()

// Get with filtering and pagination
const filtered = await db.get({
  orderBy: 'desc', // 'asc' | 'desc' - order by creation time
  limit: 10, // maximum number of items
  offset: 0, // skip items (for pagination)
})

console.log(filtered)
// { total: 100, data: [...] }
```

##### `.insert<T>(value: T): Promise<IResult<T>>`

Insert a single item into the collection.

Records must be objects. An omitted or empty string ID generates a UUID v4; supplied IDs must be strings. Inserting an
existing ID merges fields into that record, preserves its original `createdAt`, and returns the merged record. Use
`insertMany()` to insert an array of records.

```typescript
const item = await db.insert({
  title: 'My Image',
  url: 'https://example.com/image.jpg',
})
```

##### `.insertMany<T>(values: T[]): Promise<IResult<T>[]>`

Insert multiple items in a single operation.

```typescript
const items = await db.insertMany([{ url: 'image1.jpg' }, { url: 'image2.jpg' }, { url: 'image3.jpg' }])
```

##### `.getById(id: string): Promise<IResult<T> | undefined>`

Retrieve a specific item by its ID.

```typescript
const item = await db.getById('some-uuid')
if (item) {
  console.log(item.url)
}
```

##### `.updateById(id: string, value: Partial<T>): Promise<boolean>`

Update an existing item by ID. Returns `true` if successful, `false` if item not found.

```typescript
const success = await db.updateById('some-uuid', {
  title: 'Updated Title',
})
```

##### `.updateMany(items: IObject[]): Promise<{ total: number, success: number }>`

Update multiple items by their IDs.

```typescript
const result = await db.updateMany([
  { id: 'id1', title: 'New Title 1' },
  { id: 'id2', title: 'New Title 2' },
])

console.log(result) // { total: 2, success: 2 }
```

##### `.removeById(id: string): Promise<void>`

Remove an item by its ID.

```typescript
await db.removeById('some-uuid')
```

##### `.removeMany(ids: string[]): Promise<{ total: number; success: number }>`

Remove several records in one write. `total` counts requested IDs, including duplicates; `success` counts distinct
records actually removed. Missing IDs are ignored. An empty batch does not write the file.

```typescript
const removed = await db.removeMany(['id1', 'id2'])
```

##### `.count(): Promise<number>` and `.hasById(id: string): Promise<boolean>`

Count records without creating a result array, or check whether an ID exists.

##### `.refresh(): Promise<ILowData | null>`

Reload the complete database from disk. Equivalent to `read(true)`.

##### `.overwrite<T>(values: T[]): Promise<IResult<T>[]>`

Replace the entire collection with new data.

```typescript
const newCollection = await db.overwrite([{ url: 'new1.jpg' }, { url: 'new2.jpg' }])
```

### JSONStore

Simple JSON file-based key-value storage.

#### Constructor

```typescript
new JSONStore(filePath: string)
```

#### Methods

##### `.get(key: string, defaultValue?: any): any`

Get a value by key.

```typescript
const value = config.get('theme', 'light')
```

##### `.set(key: string, value: any): void`

Set a value for a dot/bracket path and persist it immediately.

```typescript
config.set('theme', 'dark')
```

##### `.setMany(values: Record<string, any>): void`

Set several dot/bracket paths in one atomic write. Entries are applied in JavaScript property enumeration order. If the
write fails, the entire batch is rolled back. An empty object does not write the file.

```typescript
config.setMany({ 'ui.theme': 'dark', 'upload.allowedTypes': ['jpg', 'png'] })
```

##### `.has(key: string): boolean`

Check if a key exists.

```typescript
if (config.has('theme')) {
  // Theme is configured
}
```

##### `.unset(key: string, value?: any): boolean`

Remove a dot/bracket path and persist immediately. Returns whether the path existed. Removing an array index compacts
the array. The legacy `unset(parentPath, childPath)` overload remains available.

```typescript
config.unset('oldSetting')
```

##### `.read(flush?: boolean): IJSON`

Read data from file (automatically called on access).

##### `.write(): void`

Write current data to file.

```typescript
const data = config.read()
data.newKey = 'newValue'
config.write() // Explicitly persist edits made directly through read().
```

`write()` is unnecessary after `set()`, `setMany()`, `unset()`, or `clear()`. It throws `WRITE_CONFLICT` if the file
changed since this instance last read it. Reload and reapply the intended edits before retrying.

##### `.refresh(): IJSON`

Reload configuration synchronously. Equivalent to `read(true)`; a typed JSONStore returns its configured schema type.

## 🔧 Advanced Usage

### Refresh and concurrent access

Reads are cached per instance. Use `await db.refresh()` or `config.refresh()` to see changes made by another instance or
process; these are aliases for `read(true)`. Refresh discards unsaved changes made through returned objects. DBStore
reads remain asynchronous; JSONStore reads, writes, and refresh remain synchronous.

Mutations reload the latest file before changing it. DBStore serializes mutations to the same canonical file path within
one Node.js process; JSONStore mutations run synchronously and explicit `write()` rejects a stale snapshot. These
guarantees do not provide a cross-process transaction lock. Applications with several processes should route writes
through one owning process. Atomic file replacement prevents partial files but does not merge simultaneous writes from
independent processes.

Returned records retain the existing live-object behavior. Use the update methods to persist changes, rather than
editing returned objects and assuming those edits will be saved by a later mutation.

### Ordering and Pagination

```typescript
// Get recent items
const recent = await db.get({
  orderBy: 'desc',
  limit: 5,
})

// Pagination
const page2 = await db.get({
  limit: 20,
  offset: 20,
})
```

### Batch Operations

```typescript
// Bulk insert with error handling
try {
  const results = await db.insertMany(largeDataset)
  console.log(`Inserted ${results.length} items`)
} catch (error) {
  console.error('Bulk insert failed:', error)
}

// Batch updates
const updateResult = await db.updateMany([
  { id: 'id1', status: 'processed' },
  { id: 'id2', status: 'processed' },
  { id: 'id3', status: 'failed' },
])

console.log(`Updated ${updateResult.success}/${updateResult.total} items`)
```

### Configuration Management

```typescript
// Application settings
const settings = new JSONStore('app-settings.json')

// Default configuration
settings.setMany({
  'upload.maxSize': 10 * 1024 * 1024, // 10MB
  'upload.allowedTypes': ['jpg', 'png', 'gif'],
  'ui.theme': 'auto',
})

// Runtime access
const maxSize = settings.get('upload.maxSize')
const theme = settings.get('ui.theme', 'light')
```

## 🎯 TypeScript Support

Full TypeScript definitions are included:

```typescript
interface ImageRecord {
  url: string
  title: string
  tags: string[]
  size: number
}

const db = new DBStore<ImageRecord>('images.db', 'uploads')
const image = await db.insert({
  url: 'https://example.com/photo.jpg',
  title: 'Beautiful Sunset',
  tags: ['sunset', 'nature'],
  size: 2048576,
})

// TypeScript knows the shape of `image`
console.log(image.createdAt) // number
console.log(image.tags) // string[]
const images = await db.get() // IGetResult<ImageRecord>
const found = await db.getById(image.id) // IResult<ImageRecord> | undefined
```

Existing untyped constructors and method-level generics such as `db.insert<ImageRecord>(value)` continue to work.
`IFilter`, `IGetResult`, `IResult`, `IMetaInfo`, `IObject`, `IJSON`, `JSONValue`, and `StoreErrorCode` are exported from
the package root.

```typescript
const settings = new JSONStore<{ theme: 'light' | 'dark'; enabled?: boolean }>('settings.json')
const theme = settings.get('theme') // 'light' | 'dark'
const enabled = settings.get('enabled', false) // boolean
const limit = settings.get<number>('nested.limit', 10) // Explicit type for dynamic/nested paths
```

Types do not validate application schemas at runtime. Use your own schema validation when reading external data.

## Errors and compatibility

`StoreError` extends `Error` and supplies a stable `code` without embedding stored data in its message:

| Code             | Meaning                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `INVALID_RECORD` | A write received an unsupported record or ID type.                 |
| `INVALID_STORE`  | Parsed contents violate the required database/configuration shape. |
| `WRITE_CONFLICT` | Explicit JSON `write()` would overwrite a newer file snapshot.     |

Filesystem and compression failures also propagate to callers. DBStore retains its public `errorList` for adapter
failures. Catch errors around writes; a rejected batch restores its in-memory state and does not intentionally commit a
partial replacement. Atomicity applies to each batch call, not to a sequence of separate calls.

The gzip database layout, collection names, string IDs, timestamp fields, JSON comment support, ESM entry point, and
existing constructor arguments remain compatible with `3.0.1`. The compatibility suite tests writing and reading across
both versions. Safety corrections since that release intentionally reject malformed files, non-object JSON roots,
duplicate/invalid stored IDs, reserved index collection names, and attempts to change an ID through `updateById()`.
Corrupt files are preserved instead of being treated as empty databases. Ordering explicitly requested with `orderBy`
uses creation timestamps, and reinsertion retains the original creation time.

For legacy database inspection, run `node scripts/inspect-store.mjs path/to/piclist.db` from this repository. It reads
the file without modifying it and reports only counts of collections, records, invalid IDs, and duplicate IDs. Back up
any flagged database before an application-specific repair; IDs are never silently converted.

## Development checks

Run `yarn build`, then `yarn test`, `yarn test:unit`, `yarn test:regressions`, `yarn test:types`, `yarn test:compat`,
and `yarn test:package`. `yarn lint:check` checks formatting without changing files.

`yarn test:compat --json path/to/data.json --db path/to/piclist.db` additionally checks temporary copies of existing
files against the published `3.0.1` package. It suppresses file contents and verifies that originals remain unchanged.
`yarn benchmark` measures full-file reads and batch updates on synthetic 1,000- and 10,000-record datasets; supply other
sizes as arguments. Mutation lookups use a temporary ID map. Public reads keep their existing live-object behavior, so
individual `getById()` calls still scan the collection.

## 📄 License

[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2025-current Kuingsmile
