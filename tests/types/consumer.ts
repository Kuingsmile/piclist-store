import { DBStore, IGetResult, IJSON, IMetaInfo, IResult, JSONStore, JSONValue, StoreErrorCode } from '@piclist/store'

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

async function typedConsumer() {
  const db = new DBStore<ImageRecord>('unused.db', 'images')
  const saved = await db.insert({ url: 'example', tags: ['typed'] })
  const found: IResult<ImageRecord> | undefined = await db.getById(saved.id)
  const page: IGetResult<ImageRecord> = await db.get()
  const metadata: IMetaInfo = saved
  await db.insertMany([{ url: 'example', tags: [] }])
  await db.updateById(saved.id, { tags: ['updated'] })
  // @ts-expect-error Typed stores require the declared fields.
  await db.insert({ url: 'missing tags' })
  // @ts-expect-error Updates must retain the declared field types.
  await db.updateById(saved.id, { tags: 123 })
  // @ts-expect-error Batch updates must retain the declared field types.
  await db.updateMany([{ id: saved.id, tags: false }])
  const config = new JSONStore<{ theme: 'light' | 'dark'; enabled?: boolean }>('unused.json')
  const theme: 'light' | 'dark' = config.get('theme')
  const enabled: boolean = config.get('enabled', false)
  const nested: number | undefined = config.get<number>('nested.limit')
  const limit: number = config.get<number>('nested.limit', 10)
  const raw: IJSON = { enabled: true, values: [null, 42, { name: 'example' }] }
  const value: JSONValue = raw
  const code: StoreErrorCode = 'INVALID_RECORD'
  return { found, page, metadata, theme, enabled, nested, limit, value, code }
}

void typedConsumer
