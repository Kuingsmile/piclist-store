import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

// Resolve existing ancestors as well, so aliases share an identity before the file exists.
export function canonicalPath(filename: string): string {
  let current = resolve(filename)
  const missing: string[] = []
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(current) === current) throw error
      missing.push(basename(current))
      current = dirname(current)
    }
  }
}
