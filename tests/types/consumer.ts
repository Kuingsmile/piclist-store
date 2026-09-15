import { DBStore, JSONStore } from '@piclist/store'

interface ImageRecord {
  url: string
  tags: string[]
}

async function legacyConsumer() {
  const db = new DBStore('unused.db', 'images')
  const saved = await db.insert<ImageRecord>({ url: 'example', tags: [] })
  const found = await db.getById<ImageRecord>(saved.id)
  const tags: string[] | undefined = found?.tags
  const updated: boolean = await db.updateById(saved.id, { tags: ['new'] })
  const config = new JSONStore('unused.json')
  config.set('theme', 'dark')
  const removed: boolean = config.unset('theme')
  return { tags, updated, removed }
}

void legacyConsumer
