import { randomUUID } from 'node:crypto'

import { IInsertData, IMetaInfoMode, IObject } from '../types'
import { validateRecord } from './validation'

function metaInfoMethodWrapper(mode: IMetaInfoMode) {
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (this: any, ...args: IInsertData) {
      const transformedArgs = transformArgumentsByMode(mode, args)
      const result = await originalMethod.call(this, ...transformedArgs)
      return result
    }
  }
}

function transformArgumentsByMode(mode: IMetaInfoMode, args: IInsertData): IInsertData {
  switch (mode) {
    case IMetaInfoMode.createMany: {
      const items = args[0] as IObject[]
      const processedItems = items.map(item => generateMetaInfo(item))
      return [processedItems]
    }

    case IMetaInfoMode.create: {
      const item = args[0] as IObject
      return [generateMetaInfo(item), args[1] as boolean | undefined]
    }

    case IMetaInfoMode.updateMany: {
      const items = args[0] as IObject[]
      const processedItems = items.map(item => updateMetaInfo(item))
      return [processedItems]
    }

    case IMetaInfoMode.update: {
      const updateArgs = args as [string, IObject]
      const [id, item] = updateArgs
      return [id, updateMetaInfo(item)]
    }

    default:
      return args
  }
}

function generateMetaInfo(value: IObject): IObject {
  validateRecord(value)
  const now = Date.now()

  return {
    ...value,
    id: value.id || randomUUID(),
    createdAt: value.createdAt ?? now,
    updatedAt: now,
  }
}

function updateMetaInfo(value: IObject): IObject {
  validateRecord(value)
  return {
    ...value,
    updatedAt: Date.now(),
  }
}

export { metaInfoMethodWrapper }
