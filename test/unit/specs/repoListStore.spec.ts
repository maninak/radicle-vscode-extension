import type { Mock } from 'vitest'
import type { HttpdProject, Repo } from '../../../src/types'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchFromHttpd, getConfig } from '../../../src/helpers'
import { useRepoListStore } from '../../../src/stores/repoListStore'

const fakeStorageDir = join('fake', 'storage')

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
}))
vi.mock('../../../src/stores', () => ({
  useEnvStore: vi.fn(() => ({ extCtx: { globalStorageUri: { fsPath: fakeStorageDir } } })),
}))
vi.mock('../../../src/helpers', () => ({ fetchFromHttpd: vi.fn(), getConfig: vi.fn() }))
vi.mock('../../../src/utils', () => ({
  log: vi.fn(),
  removeTrailingSlashes: (path: string) => path.replace(/\/+$/u, ''),
}))

const existsSyncMock = existsSync as unknown as Mock
const readFileSyncMock = readFileSync as unknown as Mock
const writeFileSyncMock = writeFileSync as unknown as Mock
const renameSyncMock = renameSync as unknown as Mock
const getConfigMock = getConfig as unknown as Mock
const fetchFromHttpdMock = fetchFromHttpd as unknown as Mock

interface CachedRepoList {
  repos: { rid: string; name: string; seeding: number }[]
  fetchedAt: number
}

const endpoint = 'https://iris.radicle.network'
const cacheFile = join(fakeStorageDir, 'cloneable-repos.json')
const oneDayInMs = 24 * 60 * 60 * 1000

function makeRepo(rid: string, name: string, seeding: number, description = ''): Repo {
  return {
    rid,
    payloads: {
      'xyz.radicle.project': {
        data: { name, description, defaultBranch: 'main' },
        meta: {
          head: 'deadbeef',
          patches: { open: 0, draft: 0, archived: 0, merged: 0 },
          issues: { open: 0, closed: 0 },
        },
      },
    },
    delegates: [],
    threshold: 1,
    seeding,
    visibility: { type: 'public' },
    refs: { tags: {}, refs: {} },
  }
}

// A repo whose payloads carry no `xyz.radicle.project` entry, so it maps to zero list items.
function makeRepoWithoutProject(rid: string): Repo {
  return {
    rid,
    payloads: {},
    delegates: [],
    threshold: 1,
    seeding: 0,
    visibility: { type: 'public' },
    refs: { tags: {}, refs: {} },
  }
}

function makeProject(
  id: string,
  name: string,
  seeding: number,
  description = '',
): HttpdProject {
  return {
    id: id as HttpdProject['id'],
    name,
    description,
    seeding,
    visibility: { type: 'public' },
  }
}

/**
 * Path-aware, paginated `fetchFromHttpd` mock: `/` reports the API version, then each list
 * page is served from `pages` indexed by the request's `page` query (missing pages resolve
 * to empty).
 */
function mockHttpd(opts: {
  apiVersion?: string
  repoPages?: Repo[][]
  projectPages?: HttpdProject[][]
  errorOnPage?: number
}): void {
  fetchFromHttpdMock.mockImplementation(
    (path: string, options?: { query?: { page?: number } }) => {
      if (path === '/') {
        return { data: { apiVersion: opts.apiVersion ?? '3.0.0' } }
      }
      const page = options?.query?.page ?? 0
      if (opts.errorOnPage === page) {
        return { error: new Error('httpd unreachable') }
      }
      if (path === '/projects') {
        return { data: opts.projectPages?.[page] ?? [] }
      }

      return { data: opts.repoPages?.[page] ?? [] }
    },
  )
}

function seedCache(
  repos: { rid: string; name: string; seeding: number }[],
  fetchedAt: number,
) {
  existsSyncMock.mockReturnValue(true)
  readFileSyncMock.mockReturnValue(JSON.stringify({ [endpoint]: { repos, fetchedAt } }))
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  existsSyncMock.mockReturnValue(false)
  getConfigMock.mockReturnValue(endpoint)
  delete process.env['RAD_E2E_DISABLE_REPO_LIST_CACHE']
})

afterEach(() => {
  delete process.env['RAD_E2E_DISABLE_REPO_LIST_CACHE']
})

describe('repoListStore', () => {
  it('seeds the repo list for the current endpoint from the machine-local cache', () => {
    seedCache([{ rid: 'rad:zCACHED', name: 'cached', seeding: 3 }], Date.now())

    const store = useRepoListStore()

    expect(store.getRepos()).toEqual([{ rid: 'rad:zCACHED', name: 'cached', seeding: 3 }])
  })

  it('fetches from the current API `/repos` and maps its nested shape', async () => {
    mockHttpd({ apiVersion: '3.0.0', repoPages: [[makeRepo('rad:zA', 'a', 9, 'desc a')]] })

    const store = useRepoListStore()
    await store.refreshRepoList()

    expect(fetchFromHttpdMock).toHaveBeenCalledWith('/repos', {
      query: { show: 'all', page: 0, perPage: 500 },
    })

    expect(fetchFromHttpdMock).not.toHaveBeenCalledWith('/projects', expect.anything())
    expect(store.getRepos()).toEqual([
      { rid: 'rad:zA', name: 'a', description: 'desc a', seeding: 9 },
    ])
  })

  it('fetches from a pre-v3 API `/projects` and maps its flatter shape', async () => {
    mockHttpd({
      apiVersion: '1.0.0',
      projectPages: [[makeProject('rad:zOLD', 'old', 7, 'desc')]],
    })

    const store = useRepoListStore()
    await store.refreshRepoList()

    expect(fetchFromHttpdMock).toHaveBeenCalledWith('/projects', {
      query: { show: 'all', page: 0, perPage: 500 },
    })

    expect(fetchFromHttpdMock).not.toHaveBeenCalledWith('/repos', expect.anything())
    expect(store.getRepos()).toEqual([
      { rid: 'rad:zOLD', name: 'old', description: 'desc', seeding: 7 },
    ])
  })

  it('walks every page until a short page ends it, and grows the list live per page', async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) => makeRepo(`rad:z${i}`, `r${i}`, 1))
    const lastPage = [makeRepo('rad:zLAST', 'last', 1)]
    mockHttpd({ repoPages: [fullPage, lastPage] })

    const store = useRepoListStore()
    // Prove the list is populated live: by the time page 1 is requested, page 0 is already in.
    let reposWhenSecondPageRequested = 0
    fetchFromHttpdMock.mockImplementation(
      (path: string, options?: { query?: { page?: number } }) => {
        if (path === '/') {
          return { data: { apiVersion: '3.0.0' } }
        }
        const page = options?.query?.page ?? 0
        if (page === 1) {
          reposWhenSecondPageRequested = store.getRepos().length

          return { data: lastPage }
        }

        return { data: fullPage }
      },
    )

    await store.refreshRepoList()

    expect(reposWhenSecondPageRequested).toBe(500)
    expect(store.getRepos()).toHaveLength(501)
    expect(fetchFromHttpdMock).toHaveBeenCalledWith('/repos', {
      query: { show: 'all', page: 1, perPage: 500 },
    })
  })

  it('keeps only the top 10000 by seed count in memory but caches all of them on disk', async () => {
    // 10001 repos, `seeding` = index, so the sole seeding-0 repo is dropped from the
    // in-memory set
    const repos = Array.from({ length: 10001 }, (_, i) => makeRepo(`rad:z${i}`, `r${i}`, i))
    const pages = Array.from({ length: Math.ceil(repos.length / 500) }, (_, pageIndex) =>
      repos.slice(pageIndex * 500, pageIndex * 500 + 500),
    )
    mockHttpd({ repoPages: pages })

    const store = useRepoListStore()
    await store.refreshRepoList()
    const inMemory = store.getRepos()

    expect(inMemory).toHaveLength(10000)
    expect(inMemory.some((repo) => repo.seeding === 0)).toBe(false)
    expect(inMemory[0]!.seeding).toBe(10000)

    const [, contents] = writeFileSyncMock.mock.calls.at(-1)! as [string, string]
    const onDisk = JSON.parse(contents) as Record<string, CachedRepoList>

    expect(onDisk[endpoint]!.repos).toHaveLength(10001)
  })

  it('persists the fetched list keyed by endpoint, with a fetch timestamp', async () => {
    mockHttpd({ repoPages: [[makeRepo('rad:zA', 'a', 1)]] })

    const store = useRepoListStore()
    await store.refreshRepoList()

    expect(writeFileSyncMock).toHaveBeenCalledTimes(1)
    const [path, contents] = writeFileSyncMock.mock.calls[0]! as [string, string]

    // written atomically: to a temp file, then renamed into place
    expect(path).toBe(`${cacheFile}.tmp`)
    expect(renameSyncMock).toHaveBeenCalledWith(`${cacheFile}.tmp`, cacheFile)
    const cached = JSON.parse(contents) as Record<string, CachedRepoList>

    expect(cached[endpoint]!.repos).toHaveLength(1)
    expect(typeof cached[endpoint]!.fetchedAt).toBe('number')
  })

  it('skips the refresh entirely when the cache is fresh', async () => {
    seedCache([{ rid: 'rad:zC', name: 'c', seeding: 1 }], Date.now())

    const store = useRepoListStore()
    await store.refreshRepoList()

    expect(fetchFromHttpdMock).not.toHaveBeenCalled()
  })

  it('refreshes when the cache is older than a day', async () => {
    seedCache([{ rid: 'rad:zC', name: 'c', seeding: 1 }], Date.now() - oneDayInMs - 1)
    mockHttpd({ repoPages: [[makeRepo('rad:zFRESH', 'fresh', 2)]] })

    const store = useRepoListStore()
    await store.refreshRepoList()

    expect(fetchFromHttpdMock).toHaveBeenCalled()
    expect(store.getRepos()).toEqual([
      { rid: 'rad:zFRESH', name: 'fresh', description: '', seeding: 2 },
    ])
  })

  it('refreshes a fresh cache anyway when forced', async () => {
    seedCache([{ rid: 'rad:zC', name: 'c', seeding: 1 }], Date.now())
    mockHttpd({ repoPages: [[makeRepo('rad:zFORCED', 'forced', 2)]] })

    const store = useRepoListStore()
    await store.refreshRepoList({ force: true })

    expect(fetchFromHttpdMock).toHaveBeenCalled()
  })

  it('returns the error and persists nothing when the very first page fails', async () => {
    mockHttpd({ errorOnPage: 0 })

    const store = useRepoListStore()
    const result = await store.refreshRepoList()

    expect(result?.error).toBeInstanceOf(Error)
    expect(store.getRepos()).toEqual([])
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('surfaces the error and does not cache a partial list when a later page fails', async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) => makeRepo(`rad:z${i}`, `r${i}`, 1))
    mockHttpd({ repoPages: [fullPage], errorOnPage: 1 })

    const store = useRepoListStore()
    const result = await store.refreshRepoList()

    // the partial fetch still feeds the picker this session, but must not be persisted or
    // timestamped as complete, so the next open retries instead of serving a truncated list
    expect(result?.error).toBeInstanceOf(Error)
    expect(store.getRepos()).toHaveLength(500)
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('keeps paginating when a full page shrinks after filtering out non-project repos', async () => {
    // A full raw page (500) where some entries carry no project payload: the mapped `items`
    // are fewer than 500, but pagination must key off the raw page size, not the filtered
    // count.
    const page0 = Array.from({ length: 500 }, (_, i) =>
      i < 5 ? makeRepoWithoutProject(`rad:zNP${i}`) : makeRepo(`rad:z${i}`, `r${i}`, 1),
    )
    mockHttpd({ repoPages: [page0, [makeRepo('rad:zLAST', 'last', 1)]] })

    const store = useRepoListStore()
    await store.refreshRepoList()

    expect(fetchFromHttpdMock).toHaveBeenCalledWith('/repos', {
      query: { show: 'all', page: 1, perPage: 500 },
    })

    expect(store.getRepos().some((repo) => repo.name === 'last')).toBe(true)
  })

  it('never reads or writes the cache when disabled for e2e, and always fetches', async () => {
    process.env['RAD_E2E_DISABLE_REPO_LIST_CACHE'] = 'true'
    seedCache([{ rid: 'rad:zC', name: 'c', seeding: 1 }], Date.now())
    mockHttpd({ repoPages: [[makeRepo('rad:zLIVE', 'live', 1)]] })

    const store = useRepoListStore()

    expect(readFileSyncMock).not.toHaveBeenCalled()
    // fresh timestamp would normally throttle, but the disabled cache forces a live fetch
    await store.refreshRepoList()

    expect(fetchFromHttpdMock).toHaveBeenCalled()
    expect(writeFileSyncMock).not.toHaveBeenCalled()
    expect(store.getRepos()).toEqual([
      { rid: 'rad:zLIVE', name: 'live', description: '', seeding: 1 },
    ])
  })
})
