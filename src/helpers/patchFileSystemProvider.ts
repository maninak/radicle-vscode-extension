import {
  type Disposable,
  type Event,
  EventEmitter,
  type FileChangeEvent,
  type FileStat,
  FileSystemError,
  type FileSystemProvider,
  FileType,
  Uri,
  workspace,
} from 'vscode'
import { useEnvStore } from '../stores'
import { log } from '../utils'
import { loadFileAtCommit } from './patchData'

/*
 * Serves the contents of a Radicle Patch's changed files directly from the local node's storage
 * repo, so the diff editor can render them without ever writing a temporary file to disk. A file
 * blob is addressed by the immutable `(rid, commit, path)` triple, hence its content never
 * changes: URIs are stable, `mtime` is irrelevant, and blobs are safe to cache indefinitely.
 */

const scheme = 'radicle-patch'

interface BlobParams {
  rid: `rad:${string}`
  commit: string
  path: string
}

/** Builds the URI whose contents are the given file's bytes as of the given commit. */
export function toPatchFileBlobUri(params: BlobParams): Uri {
  return Uri.from({
    scheme,
    path: params.path.startsWith('/') ? params.path : `/${params.path}`,
    query: JSON.stringify({ rid: params.rid, commit: params.commit }),
  })
}

/**
 * Builds the URI for the "missing" side of a diff (e.g. the old version of an added file), which
 * renders as empty. `path` is carried only so the diff editor labels the tab sensibly.
 */
export function toEmptyBlobUri(path: string): Uri {
  return Uri.from({
    scheme,
    path: path.startsWith('/') ? path : `/${path}`,
    query: JSON.stringify({ empty: true }),
  })
}

const emptyContent = new Uint8Array(0)

function createPatchFileSystemProvider(): FileSystemProvider {
  // blobs are immutable per `(rid, commit, path)`, so content is safe to cache indefinitely
  const contentByKey = new Map<string, Uint8Array>()
  const changeEmitter = new EventEmitter<FileChangeEvent[]>()
  const onDidChangeFile: Event<FileChangeEvent[]> = changeEmitter.event

  function resolveContent(uri: Uri): Uint8Array {
    const query = JSON.parse(uri.query || '{}') as Partial<BlobParams> & { empty?: boolean }
    if (query.empty || !query.rid || !query.commit) {
      return emptyContent
    }

    const path = uri.path.replace(/^\//, '')
    const key = `${query.rid} ${query.commit} ${path}`
    const cached = contentByKey.get(key)
    if (cached) {
      return cached
    }

    const { data, error } = loadFileAtCommit(query.rid, query.commit, path)
    if (error) {
      log(
        `Failed loading "${path}" at commit ${query.commit} to render its Patch diff`,
        'error',
        error.message,
      )

      return emptyContent
    }

    const content = new TextEncoder().encode(data)
    contentByKey.set(key, content)

    return content
  }

  function throwReadonly(): never {
    throw FileSystemError.NoPermissions()
  }

  return {
    onDidChangeFile,
    // blobs are immutable, so there is nothing to watch
    watch: (): Disposable => ({ dispose: () => undefined }),
    stat: (uri): FileStat => ({
      type: FileType.File,
      ctime: 0,
      mtime: 0,
      size: resolveContent(uri).length,
    }),
    readFile: (uri): Uint8Array => resolveContent(uri),
    readDirectory: throwReadonly,
    createDirectory: throwReadonly,
    writeFile: throwReadonly,
    delete: throwReadonly,
    rename: throwReadonly,
  }
}

/**
 * Registers the file system provider that backs the `radicle-patch:` scheme, serving Patch file
 * blobs from the local node's storage repo so their diffs need no temporary files on disk.
 */
export function registerAllFileSystemProviders(): void {
  useEnvStore().extCtx.subscriptions.push(
    workspace.registerFileSystemProvider(scheme, createPatchFileSystemProvider(), {
      isCaseSensitive: true,
      isReadonly: true,
    }),
  )
}
