import { isBuiltin } from 'node:module'

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'

const dependencies = ['write-file-atomic', 'lowdb', 'fflate', 'fs-extra', 'lodash', 'comment-json', 'tslib']
const external = id => isBuiltin(id) || dependencies.some(name => id === name || id.startsWith(name + '/'))

export default [
  // Main library build
  {
    input: 'src/index.ts',
    output: [
      {
        file: 'dist/index.js',
        format: 'esm',
        sourcemap: true,
        exports: 'named',
      },
    ],
    external,
    plugins: [
      nodeResolve({
        preferBuiltins: true,
      }),
      commonjs(),
      json(),
      typescript({
        tsconfig: './tsconfig.json',
        declaration: false,
      }),
    ],
  },
  // Type definitions
  {
    input: 'src/index.ts',
    output: {
      file: 'dist/index.d.ts',
      format: 'esm',
    },
    plugins: [dts()],
  },
]
