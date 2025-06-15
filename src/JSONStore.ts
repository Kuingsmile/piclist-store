import lodash from 'lodash'
import { LowSync } from 'lowdb'

import { JSONAdapter } from './adapters/JSONAdapter'
import { IJSON } from './types'

class LowWithLodash<T> extends LowSync<T> {
  chain: lodash.ExpChain<this['data']> = lodash.chain(this).get('data')
}

class JSONStore {
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
      this.hasRead = true
      this.db.read()
    }
    return this.db.data as IJSON
  }

  get(key = ''): any {
    return this.db.chain.get(key).value()
  }

  set(key: string, value: any): void {
    this.db.chain.set(key, value).value()
    this.db.write()
  }

  has(key: string): boolean {
    return this.db.chain.has(key).value()
  }

  unset(key: string, value?: any): boolean {
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

  clear(): void {
    this.db.data = {}
    this.db.write()
  }
}

export { JSONStore }
