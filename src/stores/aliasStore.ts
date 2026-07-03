import type { NId } from '../types'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { shallowRef } from '@vue/reactivity'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { useEnvStore } from '.'
import { readAliasesFromNodeDb } from '../helpers'
import { log } from '../utils'

setActivePinia(createPinia())

/**
 * Holds the mapping of node ids to their aliases, sourced from the local node's address book
 * (see `readAliasesFromNodeDb`) and cached machine-locally so aliases render instantly on the
 * next activation, before the address book is re-read.
 */
export const useAliasStore = defineStore('aliasStore', () => {
  /**
   * Shallow on purpose: `resolveAlias` runs per identity while mapping a whole repo's patches
   * (thousands of lookups), and a deeply-reactive map makes each lookup a tracked proxy hit,
   * slowing patch loading by orders of magnitude. The map is replaced wholesale on refresh,
   * which is all the reactivity dependents need.
   */
  const aliasByNId = shallowRef<Record<NId, string>>({})
  loadCachedAliases()

  function cacheFilePath(): string | undefined {
    const storageUri = useEnvStore().extCtx?.globalStorageUri

    return storageUri ? join(storageUri.fsPath, 'aliases.json') : undefined
  }

  /**
   * Seeds the in-memory map from the machine-local cache file. Runs once, at store setup, so
   * that `resolveAlias` stays a pure lookup on the hot patch-mapping path.
   */
  function loadCachedAliases(): void {
    const path = cacheFilePath()
    if (!path || !existsSync(path)) {
      return
    }

    try {
      const cached = JSON.parse(readFileSync(path, 'utf-8')) as Record<NId, string>
      aliasByNId.value = cached
      log(`Loaded ${Object.keys(cached).length} node aliases from the local cache`, 'info')
    } catch (error) {
      log(
        'Failed reading cached node aliases',
        'warn',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Resolves a node id to its alias, if known. Synchronous, backed by the in-memory map
   * (seeded from the machine-local cache and refreshed from the node's address book).
   */
  function resolveAlias(nid: NId): string | undefined {
    return aliasByNId.value[nid]
  }

  /**
   * Refreshes aliases from the node's address book and persists them to the machine-local
   * cache. Updates the reactive map only when something actually changed, so dependents
   * (e.g. the patches view) don't re-render needlessly.
   */
  async function refreshAliases({
    minimizeUserNotifications = false,
  }: { minimizeUserNotifications?: boolean } = {}): Promise<void> {
    const alreadyReportedFromCache = Object.keys(aliasByNId.value).length > 0

    const freshMap = await readAliasesFromNodeDb()
    if (!freshMap.size) {
      return // read failed or empty; keep whatever we already had
    }
    // On activation, avoid a second near-identical line when the cache already reported a
    // count; a fresh install with no cache still gets this one so the load is never silent.
    if (!(minimizeUserNotifications && alreadyReportedFromCache)) {
      log(`Read ${freshMap.size} node aliases from the local address book`, 'info')
    }

    const current = aliasByNId.value
    const hasChanged =
      freshMap.size !== Object.keys(current).length ||
      [...freshMap].some(([nid, alias]) => current[nid] !== alias)
    if (!hasChanged) {
      return
    }

    const fresh = Object.fromEntries(freshMap)
    aliasByNId.value = fresh
    persistCache(fresh)
  }

  function persistCache(aliases: Record<NId, string>): void {
    const path = cacheFilePath()
    if (!path) {
      return
    }

    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(aliases))
    } catch (error) {
      log(
        'Failed caching node aliases',
        'warn',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  return { aliasByNId, resolveAlias, refreshAliases }
})
