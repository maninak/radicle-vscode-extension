import { copyFileSync, mkdirSync } from 'node:fs'
import esbuild from 'esbuild'

const isWatch = process.argv.includes('--watch')
const isProduction = process.argv.includes('--production')

/**
 * `sql.js` (used to read the node's sqlite address book for aliases) loads its WASM binary at
 * runtime from next to the bundle, so it must be copied into `dist/`. Using the WASM build
 * keeps the extension free of native modules and thus multi-OS.
 */
function copySqlJsWasm() {
  mkdirSync('./dist', { recursive: true })
  copyFileSync('./node_modules/sql.js/dist/sql-wasm.wasm', './dist/sql-wasm.wasm')
}

/**
 * Emits build progress and errors in the exact shape the `$esbuild-watch` / `$esbuild` VS Code
 * problem matchers expect (https://github.com/connor4312/esbuild-problem-matchers),
 * so that a failed build turns the dev task's terminal tab red and lists errors in
 * the Problems panel.
 *
 * This indirection via the esbuild JS API is needed because the esbuild CLI interleaves
 * a blank line and a code frame between the error message and its location, which the
 * matcher can't parse.
 *
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      process.stdout.write('[watch] build started\n')
    })
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`)
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`)
        }
      })
      copySqlJsWasm()
      process.stdout.write('[watch] build finished\n')
    })
  },
}

const context = await esbuild.context({
  entryPoints: ['./src/extension.ts'],
  outfile: './dist/extension.js',
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'silent', // suppress esbuild's own error printing
  plugins: [problemMatcherPlugin],
})

if (isWatch) {
  await context.watch()
} else {
  try {
    await context.rebuild()
  } catch {
    process.exit(1) // errors got already printed by the plugin above; just exit silently
  } finally {
    await context.dispose()
  }
}
