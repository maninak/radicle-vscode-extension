import type { NId } from '../types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { log } from '../utils'
import { execRad } from './exec'

let sqlJs: ReturnType<typeof initSqlJs> | undefined

/**
 * Reads the local node's address book (`<nodeHome>/node/node.db`) and returns a map of every
 * known node id to its gossiped alias.
 *
 * `rad cob show` (unlike httpd) resolves no aliases and there is no CLI to look them up, so we
 * read the node's sqlite address book directly via a WASM sqlite reader (`sql.js`, no native
 * modules, so multi-OS support is preserved). This is the only data sourced outside the CLI,
 * and the only way to reach httpd-level alias coverage.
 *
 * Version-tolerant on purpose: any failure (schema change, missing/locked db, read error)
 * resolves to an empty map so patch loading never breaks over aliases.
 */
export async function readAliasesFromNodeDb(): Promise<Map<NId, string>> {
  try {
    const { stdout: nodeHome } = execRad(['self', '--home'])
    if (!nodeHome) {
      throw new Error('Failed resolving the Radicle node home to locate its address book')
    }

    // `__dirname` is the bundle dir (`dist/`), next to which the build copies `sql-wasm.wasm`.
    // Reset the memoized init if it rejects, so a transient failure (e.g. racing the wasm
    // copy on first run) doesn't wedge alias resolution for the rest of the session.
    sqlJs ??= initSqlJs({ locateFile: (file) => join(__dirname, file) })
    const sqlJsModule = await sqlJs.catch((error: unknown) => {
      sqlJs = undefined

      throw error
    })
    const db = new sqlJsModule.Database(readFileSync(join(nodeHome, 'node', 'node.db')))

    try {
      const [result] = db.exec("SELECT id, alias FROM nodes WHERE alias != ''")

      const aliasByNId = new Map<NId, string>()
      for (const [id, alias] of result?.values ?? []) {
        if (typeof id === 'string' && typeof alias === 'string') {
          aliasByNId.set(id, alias)
        }
      }

      return aliasByNId
    } finally {
      db.close()
    }
  } catch (error) {
    // A missing db is the normal "node was never started" state, not a failure, so don't cry
    // wolf on every activation; still log it (at info) rather than swallowing it silently.
    const isMissingDb =
      error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT'
    log(
      isMissingDb
        ? 'No local Radicle node address book found yet; node ids will render without aliases'
        : 'Failed reading node aliases from the local address book; falling back to node ids',
      isMissingDb ? 'info' : 'warn',
      error instanceof Error ? error.message : String(error),
    )

    return new Map()
  }
}
