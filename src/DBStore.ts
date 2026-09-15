import { AsyncLocalStorage } from 'node:async_hooks'

import { Low } from 'lowdb'

import { ZlibAdapter } from './adapters/ZlibAdapter'
import { IFilter, IGetResult, ILowData, ILowDataKeyMap, IMetaInfoMode, IObject, IResult } from './types'
import { canonicalPath } from './utils/fileIdentity'
import { metaInfoMethodWrapper } from './utils/metaInfoHelper'

class DBStore<T = IObject> {
  private static readonly mutationQueues = new Map<string, Promise<void>>()
  private static mutation(_target: any, _name: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value
    descriptor.value = function (this: DBStore, ...args: any[]) {
      return this.mutate(() => original.apply(this, args))
    }
  }
  private readonly db: Low<ILowData>
  private readonly collectionName: string
  private readonly collectionKey: string
  private hasRead = false
  private reading: Promise<void> | null = null
  private readonly fileKey: string
  private readonly mutationContext = new AsyncLocalStorage<boolean>()
  private recordIndex: Map<string, IResult<IObject>> | null = null
  public errorList: (Error | string)[] = []
  private readonly adapter: ZlibAdapter

  constructor(dbPath: string, collectionName: string) {
    if (!dbPath || !collectionName) {
      throw Error('Please provide valid dbPath or collectionName')
    }
    if (/^__.*_KEY__$/.test(collectionName)) throw new Error('Collection name is reserved for database indexes')
    this.collectionName = collectionName
    this.collectionKey = `__${collectionName}_KEY__`
    const filename = canonicalPath(dbPath)
    this.fileKey = process.platform === 'win32' ? filename.toLowerCase() : filename
    this.adapter = new ZlibAdapter(filename, collectionName, this.errorList)
    this.db = new Low<ILowData>(this.adapter, {
      [this.collectionName]: [],
      [this.collectionKey]: Object.create(null),
    })
  }

  getAdapter(): ZlibAdapter {
    return this.adapter
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (this.mutationContext.getStore()) return operation()
    const previousMutation = DBStore.mutationQueues.get(this.fileKey) ?? Promise.resolve()
    const pending = previousMutation.then(() =>
      this.mutationContext.run(true, async () => {
        await this.read(true)
        const previous = this.db.data
        this.db.data = structuredClone(previous)
        try {
          return await operation()
        } catch (error) {
          this.db.data = previous
          throw error
        } finally {
          // Public reads return live objects for compatibility. Never reuse an index
          // after exposing these objects to callers outside the isolated mutation.
          this.recordIndex = null
        }
      }),
    )
    const settled = pending.then(
      () => {},
      () => {},
    )
    DBStore.mutationQueues.set(this.fileKey, settled)
    void settled.then(() => {
      if (DBStore.mutationQueues.get(this.fileKey) === settled) DBStore.mutationQueues.delete(this.fileKey)
    })
    return pending
  }

  async read(flush = false): Promise<ILowData | null> {
    if (!this.mutationContext.getStore()) await DBStore.mutationQueues.get(this.fileKey)
    if (!this.reading && (flush || !this.hasRead)) {
      this.hasRead = false
      this.reading = this.db
        .read()
        .then(() => {
          this.recordIndex = null
          this.hasRead = true
        })
        .finally(() => {
          this.reading = null
        })
    }
    await this.reading
    return this.db.data
  }

  async get(filter?: IFilter): Promise<IGetResult<T>> {
    let data: IResult<IObject>[] = (await this.getCollection()).slice()
    const total = data.length
    if (filter !== undefined) {
      if (filter.orderBy === 'asc' || filter.orderBy === 'desc') {
        const direction = filter.orderBy === 'desc' ? -1 : 1
        data.sort((left, right) => direction * (left.createdAt - right.createdAt))
      }
      if (typeof filter.offset === 'number' && filter.offset >= 0) {
        data = data.slice(filter.offset)
      }
      if (typeof filter.limit === 'number' && filter.limit > 0) {
        data = data.slice(0, filter.limit)
      }
    }
    return {
      total,
      data: data as IResult<T>[],
    }
  }

  /** Reload the file after changes by another store or process. */
  async refresh(): Promise<ILowData | null> {
    return this.read(true)
  }

  private async getCollection(): Promise<IResult<IObject>[]> {
    return (await this.read())?.[this.collectionName] as IResult<IObject>[]
  }

  private async findRecord(id: string): Promise<IResult<IObject> | undefined> {
    const collection = await this.getCollection()
    if (!this.mutationContext.getStore()) return collection.find(item => item.id === id)
    this.recordIndex ??= new Map(collection.map(item => [item.id, item]))
    return this.recordIndex.get(id)
  }

  private async getCollectionKey(id: string): Promise<1 | null> {
    const index = await this.getCollectionKeyMap()
    return Object.hasOwn(index, id) ? index[id] : null
  }

  private async getCollectionKeyMap(): Promise<ILowDataKeyMap> {
    return (await this.read())?.[this.collectionKey] as ILowDataKeyMap
  }

  private async setCollectionKey(id: string): Promise<void> {
    await this.read()
    const data = this.db.data!
    const collectionKeyMap = data[this.collectionKey] as ILowDataKeyMap
    Object.defineProperty(collectionKeyMap, id, { value: 1, enumerable: true, writable: true, configurable: true })
  }

  @DBStore.mutation
  @metaInfoMethodWrapper(IMetaInfoMode.create)
  async insert<U extends T = T>(value: U, writable = true): Promise<IResult<U>> {
    const id = (value as IResult<U>).id
    const result = await this.getCollectionKey(id)
    if (result) {
      const item = await this.findRecord(id)
      if (!item) throw new Error('Database index does not match the collection')
      Object.assign(item, value, { id: item.id, createdAt: item.createdAt })
      if (writable) await this.db.write()
      return item as IResult<U>
    }
    ;(await this.getCollection()).push(value as IResult<IObject>)
    this.recordIndex?.set(id, value as IResult<IObject>)
    await this.setCollectionKey(id)
    if (writable) {
      await this.db.write()
    }
    return value as IResult<U>
  }

  @DBStore.mutation
  async insertMany<U extends T = T>(value: U[]): Promise<IResult<U>[]> {
    const results: IResult<U>[] = []
    for (const item of value) {
      results.push(await this.insert(item, false))
    }
    await this.db.write()
    return results
  }

  @DBStore.mutation
  @metaInfoMethodWrapper(IMetaInfoMode.update)
  async updateById(id: string, value: Partial<T> & IObject): Promise<boolean> {
    if (value.id !== undefined && value.id !== id) throw new Error('Record IDs cannot be changed')
    const result = await this.getCollectionKey(id)
    if (result) {
      const item = await this.findRecord(id)
      if (!item) return false
      Object.assign(item, value, { id })
      await this.db.write()
      return true
    } else {
      return false
    }
  }

  @DBStore.mutation
  @metaInfoMethodWrapper(IMetaInfoMode.updateMany)
  async updateMany(list: (Partial<T> & IObject)[]): Promise<{ total: number; success: number }> {
    let successCount = 0
    for (const item of list) {
      if (item.id) {
        const result = await this.getCollectionKey(item.id)
        if (result) {
          const target = await this.findRecord(item.id)
          if (!target) continue
          Object.assign(target, item)
          successCount++
        }
      }
    }
    await this.db.write()
    return {
      success: successCount,
      total: list.length,
    }
  }

  async getById<U = T>(id: string): Promise<IResult<U> | undefined> {
    return (await this.findRecord(id)) as IResult<U> | undefined
  }

  async count(): Promise<number> {
    return (await this.getCollection()).length
  }

  async hasById(id: string): Promise<boolean> {
    return (await this.getCollectionKey(id)) !== null
  }

  @DBStore.mutation
  async removeMany(ids: string[]): Promise<{ total: number; success: number }> {
    const requested = new Set(ids)
    const collection = await this.getCollection()
    const index = await this.getCollectionKeyMap()
    const remaining = collection.filter(item => !requested.has(item.id))
    const success = collection.length - remaining.length
    if (success > 0) {
      this.db.data[this.collectionName] = remaining
      for (const id of requested) {
        delete index[id]
        this.recordIndex?.delete(id)
      }
      await this.db.write()
    }
    return { total: ids.length, success }
  }

  @DBStore.mutation
  async removeById(id: string): Promise<void> {
    const collection = await this.getCollection()
    const collectionKeyMap = await this.getCollectionKeyMap()
    const index = collection.findIndex(item => item.id === id)
    if (index !== -1) {
      collection.splice(index, 1)
      delete collectionKeyMap[id]
      this.recordIndex?.delete(id)
      await this.db.write()
    }
  }

  @DBStore.mutation
  async overwrite<U extends T = T>(value: U[]): Promise<IResult<U>[]> {
    await this.read()
    ;(this.db.data as ILowData)[this.collectionName] = []
    ;(this.db.data as ILowData)[this.collectionKey] = Object.create(null)
    this.recordIndex = null
    return await this.insertMany<U>(value)
  }
}

export { DBStore }
