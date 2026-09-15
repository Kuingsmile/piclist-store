import json from 'comment-json'
import { TextFileSync } from 'lowdb/node'
import writeFile from 'write-file-atomic'

import { IJSON } from '../types'

export class JSONAdapter {
  private readonly adapter: TextFileSync
  private readonly dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.adapter = new TextFileSync(dbPath)
  }

  read(): IJSON {
    const data = this.adapter.read()
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
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Invalid JSON store contents')
      }
    }
    if (result === null || typeof result !== 'object' || Object.getPrototypeOf(result) !== Object.prototype) {
      throw new Error('JSON store root must be an object')
    }
    return result as IJSON
  }

  write(obj: any): void {
    writeFile.sync(this.dbPath, json.stringify(obj, null, 2))
  }
}
