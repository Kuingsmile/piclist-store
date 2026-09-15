import lodash from 'lodash'
import { LowSync } from 'lowdb'

import { JSONAdapter } from './adapters/JSONAdapter'
import { IJSON } from './types'

class LowWithLodash<T> extends LowSync<T> {
  chain: lodash.ExpChain<this['data']> = lodash.chain(this).get('data')
}

class JSONStore {
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

  read(flush = false): IJSON {
    if (flush || !this.hasRead) {
      this.hasRead = false
      this.db.read()
      this.hasRead = true
    }
    return this.db.data as IJSON
  }

  get(key = '', defaultValue?: any): any {
    this.read()
    return this.db.chain.get(key, defaultValue).value()
  }

  write(): void {
    this.read()
    this.db.write()
  }

  private mutate<T>(operation: () => T): T {
    this.read()
    const previous = this.db.data
    this.db.data = lodash.cloneDeep(previous)
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
    if (value === undefined) {
      const keys = key.split('.')
      if (keys.length === 1) {
        const exists = key in this.db.data
        delete this.db.data[key]
        this.db.write()
        return exists
      } else {
        const res = lodash.unset(this.db.data, key)
        this.db.write()
        return res
      }
    } else {
      const res = this.db.chain.get(key).unset(value).value()
      this.db.write()
      return res
    }
  }

  @JSONStore.mutation
  clear(): void {
    this.read()
    this.db.data = {}
    this.db.write()
  }
}

export { JSONStore }
