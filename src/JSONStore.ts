import json from 'comment-json'
import lodash from 'lodash'
import { LowSync } from 'lowdb'

import { JSONAdapter } from './adapters/JSONAdapter'
import { IJSON } from './types'

class LowWithLodash<T> extends LowSync<T> {
  chain: lodash.ExpChain<this['data']> = lodash.chain(this).get('data')
}

class JSONStore<T extends object = IJSON> {
  private static mutation(_target: any, _name: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value
    descriptor.value = function (this: JSONStore, ...args: any[]) {
      return this.mutate(() => original.apply(this, args))
    }
  }
  private readonly db: LowWithLodash<IJSON>
  private hasRead: boolean = false

  constructor(dbPath: string) {
    if (!dbPath) {
      throw Error('Please provide valid dbPath')
    }
    const adapter = new JSONAdapter(dbPath)
    this.db = new LowWithLodash(adapter, {})
    this.read()
  }

  read(flush = false): T {
    if (flush || !this.hasRead) {
      this.hasRead = false
      this.db.read()
      this.hasRead = true
    }
    return this.db.data as T
  }

  get<K extends keyof T & string>(key: K): T[K]
  get<K extends keyof T & string, D>(key: K, defaultValue: D): Exclude<T[K], undefined> | D
  get<V>(key: string, defaultValue: V): V
  get<V = any>(key?: string): V | undefined
  get(key = '', defaultValue?: any): any {
    this.read()
    return this.db.chain.get(key, defaultValue).value()
  }

  write(): void {
    this.read()
    this.db.write()
  }

  private mutate<T>(operation: () => T): T {
    this.read(true)
    const previous = this.db.data
    this.db.data = json.parse(json.stringify(previous, null, 2)) as IJSON
    try {
      return operation()
    } catch (error) {
      this.db.data = previous
      throw error
    }
  }

  @JSONStore.mutation
  set(key: string, value: any): void {
    this.read()
    this.db.chain.set(key, value).value()
    this.db.write()
  }

  has(key: string): boolean {
    return this.db.chain.has(key).value()
  }

  @JSONStore.mutation
  unset(key: string, value?: any): boolean {
    this.read()
    if (value !== undefined && !lodash.has(this.db.data, key)) return false
    const target = value === undefined ? this.db.data : lodash.get(this.db.data, key)
    const path = value === undefined ? key : value
    if (!lodash.has(target, path)) return false
    const parts = typeof path === 'string' && Object.hasOwn(target, path) ? [path] : lodash.toPath(path)
    const leaf = parts.pop()!
    const parent = parts.length ? lodash.get(target, parts) : target
    let removed: boolean
    if (Array.isArray(parent) && /^(0|[1-9]\d*)$/.test(leaf) && Number(leaf) < parent.length) {
      parent.splice(Number(leaf), 1)
      removed = true
    } else {
      removed = lodash.unset(target, path)
    }
    this.db.write()
    return removed
  }

  @JSONStore.mutation
  clear(): void {
    this.read()
    this.db.data = {}
    this.db.write()
  }
}

export { JSONStore }
