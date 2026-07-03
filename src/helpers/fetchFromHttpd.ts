import type { XOR } from 'ts-xor'
import type {
  BlobResponse,
  DiffResponse,
  HttpdProject,
  HttpdRoot,
  Patch,
  PatchStatus,
  Repo,
} from '../types'
import { type $Fetch, FetchError, type FetchOptions, type FetchResponse, ofetch } from 'ofetch'
import { log, removeTrailingSlashes } from '../utils'
import { getConfig } from './config'

// if we ever use a proper reactive global store like pinia, `doFetch()` should move in there
// and a watcher should run `resetHttpdConnection()` upon change of config
// `radicle.advanced.httpApiEndpoint` (as of writing this, at least ^_^)
// TODO: maninak either do this in configStore, or consider having an httpdStore where we
// export fetchFromHttpd as `useHttpd().fetch()` and internally doFetch is a computed that
// depends on `useConfigStore().resolvedHttpdRootUrl` or `radicle.advanced.httpApiEndpoint`
// with some other name
let doFetch: $Fetch

/**
 * Resets the connection with httpd.
 *
 * Should be run each time any of the dependencies get updated for them to take effect.
 */
export function resetHttpdConnection(): void {
  doFetch = ofetch.create({ baseURL: getResolvedHttpdRootUrl(), query: { perPage: 200 } })
}

type FetchFromHttpdReturn<Data extends object> = Promise<
  XOR<{ data: Data; response: FetchResponse<Data> }, { error: FetchError<Data> }>
>

/**
 * An abstraction for idiomatic interaction with the Radicle HTTP API served by `httpd`.
 *
 * @example Simple request
 * ```ts
 * (await fetchFromHttpd('/')).data?.service // "radicle-httpd"
 * ```
 *
 * @example GET request with error handling
 * ```ts
 * const { data: repos, error } = await fetchFromHttpd('/repos')
 * if (error) {
 *   notifyUserAboutFetchError(error) // optionally
 *   return
 * }
 * // use `repos` ...
 * ```
 *
 * @example PATCH request with error handling
 * ```ts
 * const { error } = await fetchFromHttpd(
 *   `/repos/${repoId}/patches/${patchId}`, {
 *     method: 'PATCH',
 *     body: { state: 'merged' },
 *   },
 * )
 * if (error) {
 *   notifyUserAboutFetchError(error)
 *   return false
 * }
 * return true
 * ```
 *
 * @param path The relative path (as seen from the API's root) to the resource we want to
 * access.
 * @param options Optionally additional request options like HTTP verb or request body.
 *
 * @returns Returns either an object with the properties `data` (ready-to-use data of the
 * response) and `response` (complete response object with full context) if the request was
 * successful, or an object with the property `error` (most times set with full context) if it
 * isn't, but never both.
 */

/*
 * Extend the documentation of httpd API by adding new overload signatures here as needed.
 *
 * Overload signatures _must_ be sorted having the one with the longest `path` at the top
 * to shortest one at the botttom or TS gets confused matching a call to the right signature.
 *
 * Signatures with non-`GET` `method`, should always have that field required.
 */
export async function fetchFromHttpd(
  path: `/repos/rad:${string}/patches/${string}`,
  options: FetchOptions<'json'> & { method: 'PATCH'; body: { state: PatchStatus } },
): FetchFromHttpdReturn<Patch>
export async function fetchFromHttpd(
  path: `/repos/rad:${string}/patches/${string}`,
  options?: FetchOptions<'json'> & { method?: 'GET' },
): FetchFromHttpdReturn<Patch>
export async function fetchFromHttpd(
  path: `/repos/rad:${string}/patches`,
  options?: FetchOptions<'json'> & { query?: { status: PatchStatus | 'all' }; method?: 'GET' },
): FetchFromHttpdReturn<Patch[]>
export async function fetchFromHttpd<RevBase extends string, RevOid extends string>(
  path: `/repos/rad:${string}/diff/${RevBase}/${RevOid}`,
  options?: FetchOptions<'json'> & { method?: 'GET' },
): FetchFromHttpdReturn<DiffResponse>
export async function fetchFromHttpd<Commit extends string>(
  path: `/repos/rad:${string}/blob/${Commit}/${string}`,
  options?: FetchOptions<'json'> & { method?: 'GET' },
): FetchFromHttpdReturn<BlobResponse>
export async function fetchFromHttpd(
  path: `/repos/rad:${string}`,
  options?: FetchOptions<'json'> & { method?: 'GET' },
): FetchFromHttpdReturn<Repo>
export async function fetchFromHttpd(
  path: '/repos',
  options: FetchOptions<'json'> & {
    query: { show: 'pinned' | 'all'; page?: number; perPage?: number }
    method?: 'GET'
  },
): FetchFromHttpdReturn<Repo[]>
export async function fetchFromHttpd(
  path: '/projects',
  options: FetchOptions<'json'> & {
    query: { show: 'pinned' | 'all'; page?: number; perPage?: number }
    method?: 'GET'
  },
): FetchFromHttpdReturn<HttpdProject[]>
export async function fetchFromHttpd(
  path: '/',
  options?: FetchOptions<'json'> & { method?: 'GET' },
): FetchFromHttpdReturn<HttpdRoot>
// eslint-disable-next-line padding-line-between-statements, jsdoc/require-jsdoc
export async function fetchFromHttpd<Data extends object>(
  path: string,
  options?: FetchOptions<'json'>,
): FetchFromHttpdReturn<Data> {
  if (!doFetch) {
    resetHttpdConnection()
  }

  try {
    const response = await doFetch.raw<Data>(
      removeTrailingSlashes(path), // httpd paths don't support trailing slashes
      {
        ...(path === '/'
          ? { ...(options ?? {}), query: { perPage: undefined } } // unset `perPage` for '/'
          : (options ?? {})),
      },
    )

    return { data: response._data as Exclude<typeof response._data, undefined>, response }
  } catch (error) {
    if (error instanceof FetchError) {
      log(error.message, 'error')

      return { error: error as FetchError<Data> }
    }

    throw error // should be `throw new Error('Unhandled error in "fetchFromHttpd()"', { cause: error })` but TS ain't supporting it yet
  }
}

/**
 * Resolves the root URL of the Radicle HTTP API based on the value set in the settings.
 *
 * POST-CONDITIONS:
 * - the returned URL doesn't contain a trailing `/` char
 *
 * @example getResolvedHttpdRootUrl() // http://127.0.0.1:8080/api/v1
 *
 * @returns a string value representing the root URL of the Radicle API.
 */
function getResolvedHttpdRootUrl(): string {
  const apiRootPath = '/api/v1'
  const httpEndpoint = removeTrailingSlashes(
    getConfig('radicle.advanced.httpApiEndpoint') ??
      '<vscode-settings.radicle.advanced.httpApiEndpoint must not be empty!>',
  )

  const resolvedUrl = removeTrailingSlashes(`${httpEndpoint}${apiRootPath}`)

  return resolvedUrl
}
