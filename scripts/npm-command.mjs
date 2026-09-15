import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

// Execute npm's JS entry point directly, without command-shell interpolation on Windows.
export function npmCommand(args, options = {}) {
  const directories = [dirname(process.execPath), ...(process.env.PATH ?? '').split(delimiter)]
  const candidates = [
    process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : '',
    ...directories.flatMap(directory => [
      join(directory, 'node_modules/npm/bin/npm-cli.js'),
      join(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
      join(directory, '../share/nodejs/npm/bin/npm-cli.js'),
    ]),
  ]
  const entry = candidates.find(candidate => candidate && existsSync(candidate))
  if (!entry) throw new Error('Cannot locate npm-cli.js; install npm alongside Node.js')
  return execFileSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    timeout: 120_000,
    ...options,
  })
}
