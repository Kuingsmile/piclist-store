import { gunzip, gzip, strFromU8 } from 'fflate'
import fs from 'fs-extra'
import writeFile from 'write-file-atomic'

class ZlibAdapter {
  private readonly dbPath: string
  private readonly collectionName: string
  public errorList: (Error | string)[]
  public readCount = 0

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
    console.error(err)
    this.errorList.push(err)
    return defaultValue
  }

  async read(): Promise<any> {
    this.readCount++
    const defaultData = {
      [this.collectionName]: [],
      [`__${this.collectionName}_KEY__`]: {}
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
      return JSON.parse(str)
    } catch (err: any) {
      return this.handleError(err, defaultData)
    }
  }

  async write(data: any): Promise<void> {
    try {
      const compressedResult = await this.gzipAsync(Buffer.from(JSON.stringify(data)))
      await writeFile(this.dbPath, Buffer.from(compressedResult))
    } catch (err: any) {
      this.handleError(err)
      throw err
    }
  }
}

export { ZlibAdapter }
