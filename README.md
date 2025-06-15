# @piclist/store

[![npm version](https://badge.fury.io/js/@piclist%2Fstore.svg)](https://badge.fury.io/js/@piclist%2Fstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A simple and efficient key-value store for PicList, supporting both JSON and binary data storage with built-in compression and metadata management.

## ✨ Features

- 🗄️ **Dual Storage Options**: JSON-based and binary database storage
- 🔍 **Rich Query Interface**: Support for filtering, sorting, pagination
- 📦 **Built-in Compression**: Zlib adapter for efficient storage
- 🎯 **TypeScript Support**: Full type definitions included
- ⚡ **Async/Await**: Modern promise-based API
- 🔄 **Batch Operations**: Insert, update, and remove multiple items
- 📝 **Auto Metadata**: Automatic timestamps and unique ID generation

## 📦 Installation

```bash
npm install @piclist/store
```

## 🚀 Quick Start

### DBStore (Binary Database)

Perfect for storing large amounts of structured data with efficient querying capabilities.

```typescript
import { DBStore } from '@piclist/store'

// Initialize database with collection
const db = new DBStore('data.db', 'images')

// Insert a single item
const result = await db.insert({
  imgUrl: 'https://example.com/image.jpg',
  tags: ['nature', 'landscape'],
  size: 1024
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
config.write() // Persist to disk

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
  orderBy: 'desc',  // 'asc' | 'desc' - order by creation time
  limit: 10,        // maximum number of items
  offset: 0         // skip items (for pagination)
})

console.log(filtered)
// { total: 100, data: [...] }
```

##### `.insert<T>(value: T): Promise<IResult<T>>`

Insert a single item into the collection.

```typescript
const item = await db.insert({
  title: 'My Image',
  url: 'https://example.com/image.jpg'
})
```

##### `.insertMany<T>(values: T[]): Promise<IResult<T>[]>`

Insert multiple items in a single operation.

```typescript
const items = await db.insertMany([
  { url: 'image1.jpg' },
  { url: 'image2.jpg' },
  { url: 'image3.jpg' }
])
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
  title: 'Updated Title'
})
```

##### `.updateMany(items: IObject[]): Promise<{ total: number, success: number }>`

Update multiple items by their IDs.

```typescript
const result = await db.updateMany([
  { id: 'id1', title: 'New Title 1' },
  { id: 'id2', title: 'New Title 2' }
])

console.log(result) // { total: 2, success: 2 }
```

##### `.removeById(id: string): Promise<void>`

Remove an item by its ID.

```typescript
await db.removeById('some-uuid')
```

##### `.overwrite<T>(values: T[]): Promise<IResult<T>[]>`

Replace the entire collection with new data.

```typescript
const newCollection = await db.overwrite([
  { url: 'new1.jpg' },
  { url: 'new2.jpg' }
])
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

Set a value for a key.

```typescript
config.set('theme', 'dark')
```

##### `.has(key: string): boolean`

Check if a key exists.

```typescript
if (config.has('theme')) {
  // Theme is configured
}
```

##### `.unset(key: string): void`

Remove a key and its value.

```typescript
config.unset('oldSetting')
```

##### `.read(flush?: boolean): IJSON`

Read data from file (automatically called on access).

##### `.write(): void`

Write current data to file.

```typescript
config.set('newKey', 'newValue')
config.write() // Persist changes
```

## 🔧 Advanced Usage

### Custom Filtering

```typescript
// Get recent items
const recent = await db.get({
  orderBy: 'desc',
  limit: 5
})

// Pagination
const page2 = await db.get({
  limit: 20,
  offset: 20
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
  { id: 'id3', status: 'failed' }
])

console.log(`Updated ${updateResult.success}/${updateResult.total} items`)
```

### Configuration Management

```typescript
// Application settings
const settings = new JSONStore('app-settings.json')

// Default configuration
settings.set('upload.maxSize', 10 * 1024 * 1024) // 10MB
settings.set('upload.allowedTypes', ['jpg', 'png', 'gif'])
settings.set('ui.theme', 'auto')
settings.write()

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

const db = new DBStore('images.db', 'uploads')
const image = await db.insert<ImageRecord>({
  url: 'https://example.com/photo.jpg',
  title: 'Beautiful Sunset',
  tags: ['sunset', 'nature'],
  size: 2048576
})

// TypeScript knows the shape of `image`
console.log(image.createdAt) // number
console.log(image.tags)      // string[]
```

## 📄 License

[MIT](http://opensource.org/licenses/MIT)

Copyright (c) 2025 Kuingsmile
