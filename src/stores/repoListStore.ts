import type { FetchError } from 'ofetch'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ref, shallowRef } from '@vue/reactivity'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import { useEnvStore } from '.'
import { fetchFromHttpd, getConfig } from '../helpers'
import { log, removeTrailingSlashes } from '../utils'

setActivePinia(createPinia())

/**
 * A cloneable Radicle repo, in the minimal shape the clone picker needs. Sourced from `httpd`
 * (`/repos` on current seeds, `/projects` on pre-v3 ones) and cached machine-locally.
 */
export interface RepoListItem {
  rid: string
  name: string
  description: string
  seeding: number
}

interface CachedRepoList {
  repos: RepoListItem[]
  /** Epoch millis of the last successful full fetch, used to throttle background refreshes. */
  fetchedAt: number
}

const oneDayInMs = 24 * 60 * 60 * 1000
const perPage = 500
// Safety cap so a seed that ignores pagination can't spin us forever (500 * 200 = 100k repos).
const maxPages = 200
// The in-memory store (and thus the picker) holds only the most-seeded repos, so both stay
// bounded as the network grows. The machine-local cache file keeps the *full* set on disk;
// httpd exposes no repo timestamp, so seed count is our only ranking signal for now.
const maxReposInMemory = 10000

/**
 * Holds the list of Radicle repos available for cloning, keyed by the httpd API endpoint they
 * came from. The full fetched set is cached machine-locally (on disk); only the top
 * `maxReposInMemory` by seed count are kept in memory to feed the clone picker instantly
 * (offline included) while a throttled background refresh keeps it current.
 */
export const useRepoListStore = defineStore('repoListStore', () => {
  /**
   * Shallow on purpose: the picker reads the whole list and re-sorts it wholesale on every
   * change; deep-proxying thousands of repo entries would only add overhead. The map is
   * always replaced by reassignment, which is all the reactive dependents (the live picker)
   * need. Holds only the capped (top-seeded) subset; the full set lives on disk (see
   * `persistCache`).
   */
  const reposByEndpoint = shallowRef<Record<string, CachedRepoList>>({})
  const isRefreshing = ref(false)
  loadCache()

  function cacheFilePath(): string | undefined {
    const storageUri = useEnvStore().extCtx?.globalStorageUri

    return storageUri ? join(storageUri.fsPath, 'cloneable-repos.json') : undefined
  }

  /**
   * The configured httpd endpoint, normalized (no trailing slash) so it's a stable cache key.
   */
  function currentEndpoint(): string | undefined {
    const endpoint = getConfig('radicle.advanced.httpApiEndpoint')

    return endpoint ? removeTrailingSlashes(endpoint) : undefined
  }

  /** The e2e harness always fetches fresh so cache state can't leak between tests. */
  function isCacheDisabled(): boolean {
    return process.env['RAD_E2E_DISABLE_REPO_LIST_CACHE'] === 'true'
  }

  /**
   * Reads the full on-disk cache once, at store setup, keeping only the capped subset in
   * memory.
   */
  function loadCache(): void {
    const path = cacheFilePath()
    if (isCacheDisabled() || !path || !existsSync(path)) {
      return
    }

    try {
      const onDisk = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, CachedRepoList>
      const capped: Record<string, CachedRepoList> = {}
      for (const [endpoint, entry] of Object.entries(onDisk)) {
        capped[endpoint] = { repos: capBySeed(entry.repos), fetchedAt: entry.fetchedAt }
      }
      reposByEndpoint.value = capped
    } catch (error) {
      log(
        'Failed reading cached cloneable repos',
        'warn',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Persists the full repo set for one endpoint to disk, read-modify-writing so other
   * endpoints' entries (and their full lists) survive without ever being held in memory.
   * Writes to a temp file and renames it into place so a concurrent reader (e.g. another
   * window) never sees a half-written file.
   */
  function persistCache(endpoint: string, fullRepos: RepoListItem[], fetchedAt: number): void {
    const path = cacheFilePath()
    if (isCacheDisabled() || !path) {
      return
    }

    try {
      const onDisk = existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, CachedRepoList>)
        : {}
      onDisk[endpoint] = { repos: fullRepos, fetchedAt }
      mkdirSync(dirname(path), { recursive: true })
      const tempPath = `${path}.tmp`
      writeFileSync(tempPath, JSON.stringify(onDisk))
      renameSync(tempPath, path)
    } catch (error) {
      log(
        'Failed caching cloneable repos',
        'warn',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * The in-memory (capped) repos for the currently configured endpoint (empty if none cached
   * yet). A pure, reactive read: the live picker re-runs whenever the list is (re)assigned.
   */
  function getRepos(): RepoListItem[] {
    const endpoint = currentEndpoint()

    return endpoint ? (reposByEndpoint.value[endpoint]?.repos ?? []) : []
  }

  function setReposInMemory(
    endpoint: string,
    repos: RepoListItem[],
    fetchedAt?: number,
  ): void {
    const stamp = fetchedAt ?? reposByEndpoint.value[endpoint]?.fetchedAt ?? 0
    reposByEndpoint.value = {
      ...reposByEndpoint.value,
      [endpoint]: { repos: capBySeed(repos), fetchedAt: stamp },
    }
  }

  /**
   * Refreshes the cloneable-repo list for the current endpoint from httpd, unless a
   * successful fetch happened within the last day (pass `force` to override). Paginated and
   * version-adaptive (`/repos` on current seeds, `/projects` on pre-v3 ones). Grows the
   * in-memory list as each page arrives so the picker updates live; then, only on a fully
   * successful fetch, persists the entire set to disk and keeps the top `maxReposInMemory` by
   * seed count in memory.
   *
   * @returns an object carrying the fetch `error` if any page failed (including a partial
   * fetch, which is deliberately not cached so the next open retries), otherwise `undefined`.
   * The caller decides how to surface it (e.g. only when there's nothing cached to offer).
   */
  async function refreshRepoList({ force = false }: { force?: boolean } = {}): Promise<
    { error?: FetchError } | undefined
  > {
    const endpoint = currentEndpoint()
    if (!endpoint) {
      return undefined
    }
    const cached = reposByEndpoint.value[endpoint]
    const isFresh = cached && Date.now() - cached.fetchedAt < oneDayInMs
    if (isRefreshing.value || (!force && !isCacheDisabled() && isFresh)) {
      return undefined
    }

    isRefreshing.value = true

    try {
      const { repos, error } = await fetchAllRepos((reposSoFar) => {
        setReposInMemory(endpoint, reposSoFar)
      })

      // Only a fully completed fetch (every page succeeded) is authoritative: persist it as
      // the complete set and stamp `fetchedAt` so it won't re-fetch for a day. A partial
      // fetch (a later page failed) still feeds the picker this session but is neither cached
      // nor stamped, so the next open retries instead of serving a truncated list as if it
      // were complete.
      if (repos && !error) {
        const fetchedAt = Date.now()
        persistCache(endpoint, repos, fetchedAt)
        setReposInMemory(endpoint, repos, fetchedAt)
        log(`Fetched ${repos.length} cloneable repos from ${endpoint}`, 'info')

        return undefined
      }

      return { error }
    } finally {
      isRefreshing.value = false
    }
  }

  return { reposByEndpoint, isRefreshing, getRepos, refreshRepoList }
})

/** Keeps only the top `maxReposInMemory` repos by seed count, most-seeded first. */
function capBySeed(repos: RepoListItem[]): RepoListItem[] {
  return [...repos].sort((r1, r2) => r2.seeding - r1.seeding).slice(0, maxReposInMemory)
}

/**
 * Walks every page of the repo list from the configured endpoint, adapting to the httpd API
 * version. Calls `onPage` with the running list (every repo fetched so far, deduped by rid)
 * as each page arrives, for live UI updates.
 *
 * @returns `repos` holding everything fetched (all pages on success, or the partial list
 * gathered before a later page failed) plus the `error` if any page failed. `repos` is
 * undefined only when the very first page failed. The caller decides whether a partial result
 * is authoritative.
 */
async function fetchAllRepos(
  onPage: (reposSoFar: RepoListItem[]) => void,
): Promise<{ repos?: RepoListItem[]; error?: FetchError }> {
  const apiVersion = (await fetchFromHttpd('/')).data?.apiVersion
  const apiVersionMajor = apiVersion ? Number.parseInt(apiVersion, 10) : undefined
  const usePreV3Api = apiVersionMajor !== undefined && apiVersionMajor < 3

  const all: RepoListItem[] = []
  const seenRids = new Set<string>()
  for (let page = 0; page < maxPages; page++) {
    const { items, pageSize, error } = usePreV3Api
      ? await fetchProjectsPage(page)
      : await fetchReposPage(page)
    if (error) {
      return all.length ? { repos: all, error } : { error }
    }

    const freshItems = items.filter((repo) => !seenRids.has(repo.rid))
    for (const repo of freshItems) {
      seenRids.add(repo.rid)
    }
    all.push(...freshItems)
    onPage([...all])

    // `pageSize` is the raw count httpd returned (before filtering out non-project repos), so
    // a short page reliably means the last page. `freshItems.length === 0` guards a seed that
    // ignores the `page` param and keeps returning the same repos: without it we'd loop to
    // the cap.
    if (pageSize < perPage || freshItems.length === 0) {
      break
    }
  }

  return { repos: all }
}

async function fetchReposPage(
  page: number,
): Promise<{ items: RepoListItem[]; pageSize: number; error?: FetchError }> {
  const { data, error } = await fetchFromHttpd('/repos', {
    query: { show: 'all', page, perPage },
  })
  if (!data) {
    return { items: [], pageSize: 0, error }
  }

  const items = data.flatMap((repo) => {
    const project = repo.payloads['xyz.radicle.project']?.data

    return project
      ? [toRepoListItem(repo.rid, project.name, project.description, repo.seeding)]
      : []
  })

  return { items, pageSize: data.length }
}

async function fetchProjectsPage(
  page: number,
): Promise<{ items: RepoListItem[]; pageSize: number; error?: FetchError }> {
  const { data, error } = await fetchFromHttpd('/projects', {
    query: { show: 'all', page, perPage },
  })
  if (!data) {
    return { items: [], pageSize: 0, error }
  }

  const items = data.map((project) =>
    toRepoListItem(project.id, project.name, project.description, project.seeding),
  )

  return { items, pageSize: data.length }
}

function toRepoListItem(
  rid: string,
  name: string,
  description: string,
  seeding: number,
): RepoListItem {
  return { rid, name, description, seeding }
}
