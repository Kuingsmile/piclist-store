import { AsyncLocalStorage } from 'node:async_hooks'

import { Low } from 'lowdb'

import { ZlibAdapter } from './adapters/ZlibAdapter'
import { IFilter, IGetResult, ILowData, ILowDataKeyMap, IMetaInfoMode, IObject, IResult } from './types'
import { metaInfoMethodWrapper } from './utils/metaInfoHelper'

class DBStore {
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
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly mutationContext = new AsyncLocalStorage<boolean>()
  public errorList: (Error | string)[] = []
  private readonly adapter: ZlibAdapter

  constructor(dbPath: string, collectionName: string) {
    if (!dbPath || !collectionName) {
      throw Error('Please provide valid dbPath or collectionName')
    }
    if (/^__.*_KEY__$/.test(collectionName)) throw new Error('Collection name is reserved for database indexes')
    this.collectionName = collectionName
    this.collectionKey = `__${collectionName}_KEY__`
    this.adapter = new ZlibAdapter(dbPath, collectionName, this.errorList)
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
    const pending = this.mutationQueue.then(async () => {
      await this.read()
      const previous = this.db.data
      this.db.data = structuredClone(previous)
      try {
        return await this.mutationContext.run(true, operation)
      } catch (error) {
        this.db.data = previous
        throw error
      }
    })
    this.mutationQueue = pending.then(
      () => {},
      () => {},
    )
    return pending
  }

  async read(flush = false): Promise<ILowData | null> {
    if (!this.reading && (flush || !this.hasRead)) {
      this.hasRead = false
      this.reading = this.db
        .read()
        .then(() => {
          this.hasRead = true
        })
        .finally(() => {
          this.reading = null
        })
    }
    await this.reading
    return this.db.data
  }

  async get(filter?: IFilter): Promise<IGetResult<IObject>> {
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
      data,
    }
  }

  private async getCollection(): Promise<IResult<IObject>[]> {
    return (await this.read())?.[this.collectionName] as IResult<IObject>[]
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
  async insert<T>(value: T, writable = true): Promise<IResult<T>> {
    const id = (value as IResult<T>).id
    const result = await this.getCollectionKey(id)
    if (result) {
      const item = (await this.getCollection()).find(item => item.id === id)
      if (!item) throw new Error('Database index does not match the collection')
      Object.assign(item, value, { id: item.id, createdAt: item.createdAt })
      if (writable) await this.db.write()
      return item as IResult<T>
    }
    ;(await this.getCollection()).push(value as IResult<T>)
    await this.setCollectionKey(id)
    if (writable) {
      await this.db.write()
    }
    return value as IResult<T>
  }

  @DBStore.mutation
  @metaInfoMethodWrapper(IMetaInfoMode.createMany)
  async insertMany<T>(value: T[]): Promise<IResult<T>[]> {
    for (const item of value) {
      await this.insert(item, false)
    }
    await this.db.write()
    return value as IResult<T>[]
  }

  @DBStore.mutation
  @metaInfoMethodWrapper(IMetaInfoMode.update)
  async updateById(id: string, value: IObject): Promise<boolean> {
    if (value.id !== undefined && value.id !== id) throw new Error('Record IDs cannot be changed')
    const collection = await this.getCollection()
    const result = await this.getCollectionKey(id)
    if (result) {
      const item = collection.find(item => item.id === id)
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
  async updateMany(list: IObject[]): Promise<{ total: number; success: number }> {
    const collection = await this.getCollection()
    let successCount = 0
    for (const item of list) {
      if (item.id) {
        const result = await this.getCollectionKey(item.id)
        if (result) {
          const target = collection.find(t => t.id === item.id)
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

  async getById<T>(id: string): Promise<IResult<T> | undefined> {
    return (await this.getCollection()).find(item => item.id === id) as IResult<T>
  }

  @DBStore.mutation
  async removeById(id: string): Promise<void> {
    const collection = await this.getCollection()
    const collectionKeyMap = await this.getCollectionKeyMap()
    const index = collection.findIndex(item => item.id === id)
    if (index !== -1) {
      collection.splice(index, 1)
      delete collectionKeyMap[id]
      await this.db.write()
    }
  }

  @DBStore.mutation
  async overwrite<T>(value: T[]): Promise<IResult<T>[]> {
    await this.read()
    ;(this.db.data as ILowData)[this.collectionName] = []
    ;(this.db.data as ILowData)[this.collectionKey] = Object.create(null)
    return await this.insertMany<T>(value)
  }
}

export { DBStore }
