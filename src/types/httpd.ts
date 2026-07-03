// NOTE: all types must be _manually_ kept in sync with the shape returned by httpd

import type { ArrayMinLength } from '.'

/**
 * Decentralized Identifier. Commonly used for Radicle Identities
 */
export type DId = `did:key:${string}`
/**
 * Radicle Node Identifier. Effectively Did without the `did:key:` prefix
 */
export type NId = string

export interface RadicleIdentity {
  id: DId
  alias?: string
}

export interface HttpdRoot {
  message: string
  service: string
  version: string
  apiVersion: string
  nid: string
  path: string
  links: {
    href: string
    rel: string
    type: string
  }[]
}

export interface Repo {
  rid: string
  payloads: {
    'xyz.radicle.project'?: RepoPayload
  }
  delegates: RadicleIdentity[]
  threshold: number
  seeding: number
  visibility: { type: 'public' | 'private' }
  refs: { tags: Record<string, string>; refs: Record<string, string> }
}

/**
 * A repo as returned by the pre-v3 httpd `/projects` endpoint (e.g. radicle.at, apiVersion 1),
 * which is flatter than the current `/repos` `Repo`. Only the fields we consume are typed.
 */
export interface HttpdProject {
  id: `rad:${string}`
  name: string
  description: string
  seeding: number
  visibility: { type: 'public' | 'private' }
}

export interface RepoPayload {
  data: {
    name: string
    description: string
    defaultBranch: string
  }
  meta: {
    head: string
    patches: { [K in PatchStatus]: number }
    issues: { open: number; closed: number }
  }
}

export interface Merge {
  author: RadicleIdentity
  revision: string
  commit: string
  timestamp: number
}

export interface Patch {
  id: string
  title: string
  author: RadicleIdentity
  state:
    | { status: 'draft' }
    | { status: 'open'; conflicts?: [string, string][] }
    | { status: 'archived' }
    | { status: 'merged'; revision: string; commit: string }
  target: string
  labels: string[]
  merges: Merge[]
  assignees: string[]
  revisions: ArrayMinLength<Revision, 1>
}

export type PatchStatus = Patch['state']['status']

export function isPatch(x: unknown): x is Patch {
  const patch = x as Partial<Patch> | undefined
  const isPatch =
    patch &&
    typeof patch.id === 'string' &&
    typeof patch.title === 'string' &&
    patch.author &&
    patch.state &&
    typeof patch.target === 'string' &&
    patch.labels &&
    patch.merges &&
    patch.assignees &&
    patch.revisions

  return Boolean(isPatch)
}

export interface Revision {
  id: string
  author: RadicleIdentity
  description: string
  edits: {
    author: RadicleIdentity
    body: string
    embeds: Embed[]
    timestamp: number
  }[]
  reactions: (Reaction & { location?: CodeLocation })[]
  /**
   * The value is a commit hash
   */
  base: string
  /**
   * a.k.a. Object Identifier. The value is a commit hash.
   */
  oid: string
  refs: string[]
  discussions: Comment[]
  reviews: Review[]
  timestamp: number
}

export interface Comment {
  id: string
  author: RadicleIdentity
  body: string
  edits: Edit[]
  embeds: Embed[]
  resolved: boolean
  reactions: Reaction[]
  location?: CodeLocation
  replyTo?: string
  timestamp: number
}

export interface Edit {
  author: RadicleIdentity
  body: string
  embeds: Embed[]
  timestamp: number
}

export interface Embed {
  name: string
  content: string
}

export interface Reaction {
  emoji: string // literal Unicode char(s)
  authors: RadicleIdentity[]
}

export interface Review {
  author: RadicleIdentity
  verdict?: 'accept' | 'reject'
  summary?: string
  comment?: string
  inline?: CommentInlineWithCode[]
  timestamp: number
}
export interface CommentInlineWithCode {
  location: CodeLocation
  comment: string
  timestamp: number
}

interface CodeLocation {
  path: string
  commit: string
  lines: {
    start: number
    end: number
  }
}

export interface BlobResponse {
  binary: boolean
  name: string
  path: string
  content?: string
  lastCommit: LastCommit
}

export interface DiffResponse {
  diff: Changeset
  commits: Commit[]
  files: {
    [key: string]: {
      id: string
      binary: boolean
      content: string
      lastCommit: LastCommit
    }
  }
}

export interface Changeset {
  files: (
    | { status: 'added'; diff: Diff; path: string; new: FileRef }
    | { status: 'deleted'; diff: Diff; path: string; old: FileRef }
    | { status: 'modified'; diff: Diff; path: string; old: FileRef; new: FileRef }
    | ({ status: 'copied' } & (
        | CopiedOrMovedFilechangeWithDiff
        | CopiedOrMovedFilechangeWithoutDiff
      ))
    | ({ status: 'moved' } & (CopiedOrMovedFilechangeWithDiff | MovedFilechangeWithoutDiff))
  )[]
  stats: {
    filesChanged: number
    insertions: number
    deletions: number
  }
}
export interface CopiedOrMovedFilechangeWithDiff extends CopiedOrMovedFilechangeWithoutDiff {
  diff: Diff
  old: FileRef
  new: FileRef
}
export interface CopiedOrMovedFilechangeWithoutDiff {
  oldPath: string
  newPath: string
}
export interface MovedFilechangeWithoutDiff extends CopiedOrMovedFilechangeWithoutDiff {
  current: FileRef
}

export function isCopiedOrMovedFilechangeWithDiff(
  x: unknown,
): x is CopiedOrMovedFilechangeWithDiff {
  const filechange = x as CopiedOrMovedFilechangeWithDiff | undefined

  return Boolean(filechange?.diff)
}

export function isMovedFilechangeWithoutDiff(x: unknown): x is MovedFilechangeWithoutDiff {
  const filechange = x as MovedFilechangeWithoutDiff | undefined

  return Boolean(filechange?.current)
}

export interface FileRef {
  /**
   * Can be used as key to resolve a file under `DiffResponse.files`
   */
  oid: string
  mode: 'blob' | 'blobExecutable' | 'tree' | 'link' | 'commit'
}

export interface Diff {
  type: 'plain' | 'binary' | 'empty'
  hunks: Hunk[]
  eof: 'noneMissing' | 'oldMissing' | 'newMissing' | 'bothMissing'
}

export interface Hunk {
  header: string
  lines: HunkLine[]
  old: HunkRange
  new: HunkRange
}

export interface HunkLine {
  line: string
  lineNoOld?: number // TODO: use latest rad cli and httpd and check if those props are indeed optional or not
  lineNoNew?: number
  type: 'context' | 'addition' | 'deletion' // TODO: ensure this is not a union but HunkLine is a union instead (see JSON used in https://app.quicktype.io)
  lineNo?: number
}

export interface HunkRange {
  start: number
  end: number
}

export interface Commit {
  id: string
  summary: string
  description: string
  author: { name: string; email: string }
  committer: { name: string; email: string; time: number }
  parents: string[]
}

// TODO: see how this correleates with Commit and refactor accordingly
export interface LastCommit {
  id: string
  summary: string
  description: string
  message: string
  // TODO: check why author and committer here are the same and on Commit they are not,
  // refactor accordingly
  author: { name: string; email: string; time: number }
  committer: { name: string; email: string; time: number }
  parents: string[]
}
