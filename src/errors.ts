export type StoreErrorCode = 'INVALID_RECORD' | 'INVALID_STORE' | 'WRITE_CONFLICT'

/** Store errors never include serialized records or parser excerpts. */
export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}
