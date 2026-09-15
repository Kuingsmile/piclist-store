import json from 'comment-json'
import { TextFileSync } from 'lowdb/node'
import writeFile from 'write-file-atomic'

import { StoreError } from '../errors'
import { IJSON } from '../types'
import { canonicalPath } from '../utils/fileIdentity'

export class JSONAdapter {
  private readonly adapter: TextFileSync
  private readonly dbPath: string
  private lastRead: string | null | undefined

  constructor(dbPath: string) {
    this.dbPath = canonicalPath(dbPath)
    this.adapter = new TextFileSync(this.dbPath)
  }

  read(): IJSON {
    const data = this.adapter.read()
    this.lastRead = data
    if (data === null) {
      return {}
    }
    let result: any
    try {
      result = json.parse(data || '{}')
    } catch (_e) {
      try {
        result = JSON.parse(data)
      } catch (_error) {
        // Parser diagnostics can contain configuration secrets.

        throw new StoreError('INVALID_STORE', 'Invalid JSON store contents')
      }
    }
    if (result === null || typeof result !== 'object' || Object.getPrototypeOf(result) !== Object.prototype) {
      throw new StoreError('INVALID_STORE', 'JSON store root must be an object')
    }
    return result as IJSON
  }

  write(obj: any): void {
    if (this.lastRead !== undefined && this.adapter.read() !== this.lastRead) {
      throw new StoreError('WRITE_CONFLICT', 'JSON store changed since last read; reload before writing')
    }
    const serialized = json.stringify(obj, null, 2)
    writeFile.sync(this.dbPath, serialized)
    this.lastRead = serialized
  }
}
