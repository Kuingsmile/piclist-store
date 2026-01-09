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

export type IInsertData = IObject[] | [string, IObject] | [IObject[]]

export enum IMetaInfoMode {
  createMany,
  create,
  update,
  updateMany,
}

export type IResult<T> = T & {
  id: string
  createdAt: number
  updatedAt: number
}

export type ILowData = Record<string, IObject[] | ILowDataKeyMap>

export type ILowDataKeyMap = Record<string, 1>

export interface IJSON {
  [propsName: string]: string | number | IJSON
}
