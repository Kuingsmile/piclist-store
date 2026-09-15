import { StoreError } from '../errors'
import { IObject } from '../types'

export function validateRecord(value: unknown): asserts value is IObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new StoreError('INVALID_RECORD', 'Database records must be objects')
  }
  const id = (value as IObject).id
  if (id !== undefined && typeof id !== 'string') {
    throw new StoreError('INVALID_RECORD', 'Record IDs must be strings')
  }
}

export function validateCollection(value: unknown): asserts value is IObject[] {
  if (!Array.isArray(value)) throw new StoreError('INVALID_STORE', 'Invalid database collection')
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
      throw new StoreError('INVALID_STORE', 'Invalid or duplicate database record ID')
    }
    ids.add(item.id)
  }
}
