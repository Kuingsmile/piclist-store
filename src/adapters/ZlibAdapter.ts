import { gunzip, gzip, strFromU8 } from 'fflate'
import fs from 'fs-extra'
import writeFile from 'write-file-atomic'

import { StoreError } from '../errors'
import { validateCollection } from '../utils/validation'

class ZlibAdapter {
  private readonly dbPath: string
  private readonly collectionName: string
  public errorList: (Error | string)[]
  public readCount = 0
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(dbPath: string, collectionName: string, errorList: (Error | string)[]) {
    this.dbPath = dbPath
    this.collectionName = collectionName
    this.errorList = errorList
  }

  private gunzipAsync = (buffer: Uint8Array): Promise<Uint8Array> =>
    new Promise((resolve, reject) => gunzip(buffer, (err, data) => (err ? reject(err) : resolve(data))))

  private gzipAsync = (data: Uint8Array): Promise<Uint8Array> =>
    new Promise((resolve, reject) => gzip(data, (err, result) => (err ? reject(err) : resolve(result))))

  private handleError(err: any, defaultValue?: any) {
    this.errorList.push(err)
    return defaultValue
  }

  async read(): Promise<any> {
    this.readCount++
    const defaultData = {
      [this.collectionName]: [],
      [`__${this.collectionName}_KEY__`]: Object.create(null),
    }

    try {
      if (!fs.existsSync(this.dbPath)) {
        const compressedResult = await this.gzipAsync(Buffer.from(JSON.stringify(defaultData)))
        await writeFile(this.dbPath, Buffer.from(compressedResult))
        return defaultData
      }

      const buffer = await fs.readFile(this.dbPath)
      const decompressedData = await this.gunzipAsync(buffer)
      const str = strFromU8(decompressedData)
      let data
      try {
        data = JSON.parse(str)
      } catch {
        throw new StoreError('INVALID_STORE', 'Invalid database JSON contents')
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new StoreError('INVALID_STORE', 'Invalid database root')
      }
      const collection = Object.hasOwn(data, this.collectionName) ? data[this.collectionName] : []
      validateCollection(collection)
      const index = Object.create(null)
      for (const item of collection) {
        index[item.id!] = 1
      }
      Object.defineProperty(data, this.collectionName, {
        value: collection,
        enumerable: true,
        writable: true,
        configurable: true,
      })
      Object.defineProperty(data, `__${this.collectionName}_KEY__`, {
        value: index,
        enumerable: true,
        writable: true,
        configurable: true,
      })
      return data
    } catch (err: any) {
      this.handleError(err)
      throw err
    }
  }

  async write(data: any): Promise<void> {
    try {
      const snapshot = Buffer.from(JSON.stringify(data))
      // Validate the actual serialized records, including custom toJSON results.
      validateCollection(JSON.parse(snapshot.toString('utf8'))[this.collectionName])
      const pending = this.writeQueue.then(async () => {
        const compressedResult = await this.gzipAsync(snapshot)
        await writeFile(this.dbPath, Buffer.from(compressedResult))
      })
      this.writeQueue = pending.catch(() => {})
      await pending
    } catch (err: any) {
      this.handleError(err)
      throw err
    }
  }
}

export { ZlibAdapter }
