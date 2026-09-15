export enum IDBStatus {
  inited = 'inited',
  loaded = 'loaded',
  started = 'started',
  stopped = 'stopped',
}

export interface IFilter {
  orderBy?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export interface IGetResult<T> {
  total: number
  data: IResult<T>[]
}
export interface IObject {
  id?: string
  [propName: string]: any
}

export type IInsertData = IObject[] | [string, IObject] | [IObject[]] | [IObject, boolean?]

export enum IMetaInfoMode {
  createMany,
  create,
  update,
  updateMany,
}

export interface IMetaInfo {
  id: string
  createdAt: number
  updatedAt: number
}

export type IResult<T> = T & IMetaInfo

export type ILowData = Record<string, IObject[] | ILowDataKeyMap>

export type ILowDataKeyMap = Record<string, 1>

export interface IJSON {
  [propsName: string]: JSONValue
}

export type JSONValue = string | number | boolean | null | IJSON | JSONValue[]
