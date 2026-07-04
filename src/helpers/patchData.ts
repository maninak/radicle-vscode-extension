import type { XOR } from 'ts-xor'
import type {
  CobComment,
  CobCommentReaction,
  CobEdit,
  CobPatch,
  CobReaction,
  CobReview,
  CobRevision,
  Comment,
  Edit,
  NId,
  Patch,
  RadicleIdentity,
  Reaction,
  Review,
  Revision,
} from '../types'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { useAliasStore, useEnvStore } from '../stores'
import { log } from '../utils'
import { execGit, execRad } from './exec'

type Rid = `rad:${string}`

/*
 * The extension's patch data layer: reads patch COBs (via the `rad` CLI) and file diffs (via
 * git) straight from the local Radicle node's storage. Works fully offline and needs no
 * `radicle-httpd` running.
 *
 * These are the `load*` functions. Sourcing the same data from a remote seed's httpd (for the
 * upcoming Explorer, see issue #188) will live alongside them as its own `fetch*` variants.
 */

const patchCobType = 'xyz.radicle.patch'
/**
 * How many COBs to resolve per `rad cob show` invocation. Keeps the assembled command line
 * comfortably below Windows' ~32k character limit (each id adds ~50 chars) while still
 * needing only `ceil(n / 300)` invocations for `n` patches.
 */
const cobsPerBatch = 300

export interface PatchFilechange {
  status: 'added' | 'deleted' | 'modified' | 'copied' | 'moved'
  /** The file's path as of the new commit (for deletions: as of the old commit). */
  path: string
  /** The file's path as of the old commit. Differs from `path` only for copied/moved. */
  oldPath: string
}

/**
 * Loads a file's full contents as raw bytes, as of the given commit, from the local node's
 * storage repo. Bytes (not a decoded string) so binary blobs (images, etc.) survive intact.
 */
export function loadFileBytesAtCommit(
  rid: Rid,
  commit: string,
  filePath: string,
): XOR<{ data: Uint8Array }, { error: Error }> {
  const { path: storageRepoPath, error } = getStorageRepoPath(rid)
  if (error) {
    return { error }
  }

  try {
    // no `encoding`, so `execFileSync` returns a `Buffer` and the blob's bytes are untouched
    const bytes = execFileSync('git', ['show', `${commit}:${filePath}`], {
      cwd: storageRepoPath,
      timeout: 30_000,
      maxBuffer: 100 * 1024 * 1024,
    })

    return { data: bytes }
  } catch (err) {
    return {
      error: new Error(
        `Failed resolving "${filePath}" at commit ${commit}: ${(err as Error).message}`,
      ),
    }
  }
}

/**
 * Resolves the on-disk path of the local node's bare storage git repo for the given rid.
 *
 * The storage repo contains the objects and refs of every seeded peer, so (unlike the
 * workspace's working copy) commits referenced by patches are always resolvable in it.
 */
function getStorageRepoPath(rid: Rid): XOR<{ path: string }, { error: Error }> {
  const nodeHomeOp = execRad(['self', '--home'])
  if (nodeHomeOp.errorCode !== undefined || !nodeHomeOp.stdout) {
    return {
      error: createErrorFromExec(
        'Failed resolving the Radicle node home to locate its storage',
        nodeHomeOp,
      ),
    }
  }

  return { path: join(nodeHomeOp.stdout, 'storage', rid.replace(/^rad:/, '')) }
}

/**
 * Loads all of the given repo's patches from the local node.
 */
export function loadPatches(rid: Rid): XOR<{ data: Patch[] }, { error: Error }> {
  const listOp = execRad(['cob', 'list', '--repo', rid, '--type', patchCobType], {
    retryOnFailure: true,
  })
  if (listOp.errorCode !== undefined) {
    return { error: createErrorFromExec(`Failed listing patch COBs of ${rid}`, listOp) }
  }

  const patchIds = listOp.stdout.split(/\r?\n/).filter(Boolean)

  try {
    const patches: Patch[] = []
    for (let i = 0; i < patchIds.length; i += cobsPerBatch) {
      patches.push(...loadPatchesByIds(rid, patchIds.slice(i, i + cobsPerBatch)))
    }

    return { data: patches }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    log(err.message, 'error', `Failed assembling patches of ${rid} from the local node`)

    return { error: err }
  }
}

/**
 * Loads a single patch of the given repo from the local node.
 */
export function loadPatch(
  rid: Rid,
  patchId: Patch['id'],
): XOR<{ data: Patch }, { error: Error }> {
  try {
    const patch = loadPatchesByIds(rid, [patchId])[0]
    if (!patch) {
      throw new Error(`Failed resolving patch ${patchId} of ${rid}`)
    }

    return { data: patch }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    log(
      err.message,
      'error',
      `Failed assembling patch ${patchId} of ${rid} from the local node`,
    )

    return { error: err }
  }
}

/**
 * Resolves the given patch COBs from the local node with a single `rad cob show` invocation
 * and maps them to the extension's `Patch` shape. Throws on any failure.
 */
function loadPatchesByIds(rid: Rid, patchIds: string[]): Patch[] {
  if (!patchIds.length) {
    return []
  }

  const showOp = execRad(
    [
      'cob',
      'show',
      '--repo',
      rid,
      '--type',
      patchCobType,
      ...patchIds.flatMap((id) => ['--object', id]),
    ],
    { retryOnFailure: true },
  )
  if (showOp.errorCode !== undefined) {
    throw createErrorFromExec(
      `Failed showing ${patchIds.length} patch COB(s) of ${rid}`,
      showOp,
    )
  }

  // `rad cob show` emits one JSON object per line, in the order the objects were requested
  const cobLines = showOp.stdout.split(/\r?\n/).filter(Boolean)
  if (cobLines.length !== patchIds.length) {
    throw new Error(
      `Expected ${patchIds.length} patch COB(s) from \`rad cob show\` but got ${cobLines.length}`,
    )
  }

  // Map by index first (lines come back in the requested order), then drop redacted COBs,
  // which `rad cob show` serializes as a `null` line. Skipping them keeps one redacted patch
  // from failing the whole batch, while the length check above still guards against
  // misalignment.
  const patches = cobLines.flatMap((cobLine, indexOfRequestedId) => {
    const patchId = patchIds[indexOfRequestedId] as string
    const cob = JSON.parse(cobLine) as CobPatch | null

    return cob ? [mapCobPatchToPatch(patchId, cob)] : []
  })

  return patches
}

/**
 * Loads the list of files changed between two commits of the given repo from the local node.
 */
export function loadPatchFilechanges(
  rid: Rid,
  oldCommit: string,
  newCommit: string,
): XOR<{ data: PatchFilechange[] }, { error: Error }> {
  const { path: storageRepoPath, error: storageRepoPathError } = getStorageRepoPath(rid)
  if (storageRepoPathError) {
    return { error: storageRepoPathError }
  }

  // `-z` NUL-separates the output so paths never need (de-)quoting, `-M`/`-C` detect
  // moves/copies like httpd's diff endpoint did
  const diffOp = execGit(['diff', '--name-status', '-z', '-M', '-C', oldCommit, newCommit], {
    cwd: storageRepoPath,
    outputTrimming: false,
  })
  if (diffOp.errorCode !== undefined) {
    return {
      error: createErrorFromExec(
        `Failed diffing ${oldCommit}..${newCommit} of ${rid}`,
        diffOp,
      ),
    }
  }

  const fields = diffOp.stdout.split('\0')
  const filechanges: PatchFilechange[] = []
  for (let i = 0; i < fields.length; ) {
    const gitStatus = fields[i]
    if (!gitStatus) {
      break
    }

    const pathA = fields[i + 1]
    if (pathA === undefined) {
      return { error: new Error(`Failed parsing git diff output near "${gitStatus}"`) }
    }

    if (gitStatus.startsWith('R') || gitStatus.startsWith('C')) {
      const pathB = fields[i + 2]
      if (pathB === undefined) {
        return { error: new Error(`Failed parsing git diff output near "${gitStatus}"`) }
      }
      filechanges.push({
        status: gitStatus.startsWith('R') ? 'moved' : 'copied',
        path: pathB,
        oldPath: pathA,
      })
      i += 3
    } else {
      let status: PatchFilechange['status']
      switch (gitStatus) {
        case 'A':
          status = 'added'
          break
        case 'D':
          status = 'deleted'
          break
        case 'M':
        case 'T':
          status = 'modified'
          break
        default:
          return {
            error: new Error(`Failed parsing unexpected git diff status "${gitStatus}"`),
          }
      }
      filechanges.push({ status, path: pathA, oldPath: pathA })
      i += 2
    }
  }

  return { data: filechanges }
}

/*
 * ------------------------------------------------------------------------------------------
 * Mapping of raw patch COBs (as printed by `rad cob show`) to the extension's `Patch` shape,
 * which matches httpd's serialization so that both data sources stay interchangeable.
 * Notable differences bridged here: COB collections are id-keyed maps instead of arrays,
 * timestamps are in milliseconds instead of seconds, and identities of most actors are
 * plain node ids instead of `{ id, alias }` objects.
 * ------------------------------------------------------------------------------------------
 */

function mapCobPatchToPatch(patchId: string, cob: CobPatch): Patch {
  const revisions = Object.values(cob.revisions)
    .filter(Boolean)
    .sort((r1, r2) => r1.timestamp - r2.timestamp)
    .map(mapCobRevisionToRevision)
  if (!revisions.length) {
    throw new Error(`Patch COB ${patchId} unexpectedly has no revisions`)
  }

  const patch: Patch = {
    id: patchId,
    title: cob.title,
    author: resolveIdentityAlias(cob.author),
    state: cob.state,
    target: cob.target,
    labels: cob.labels,
    merges: Object.entries(cob.merges).map(([nid, merge]) => ({
      author: resolveIdentityFromNId(nid),
      revision: merge.revision,
      commit: merge.commit,
      timestamp: convertMsToS(merge.timestamp),
    })),
    assignees: cob.assignees,
    revisions: revisions as Patch['revisions'],
  }

  return patch
}

function mapCobRevisionToRevision(cobRevision: CobRevision): Revision {
  const revision: Revision = {
    id: cobRevision.id,
    author: resolveIdentityAlias(cobRevision.author),
    description: cobRevision.description.at(-1)?.body ?? '',
    edits: cobRevision.description.map(mapCobEditToEdit),
    reactions: cobRevision.reactions.map(mapCobReactionToReaction),
    base: cobRevision.base,
    oid: cobRevision.oid,
    refs: [],
    discussions: cobRevision.discussion.timeline
      .map((commentId) => {
        const cobComment = cobRevision.discussion.comments[commentId]

        return cobComment && mapCobCommentToComment(commentId, cobComment)
      })
      .filter(Boolean),
    reviews: Object.values(cobRevision.reviews).filter(Boolean).map(mapCobReviewToReview),
    timestamp: convertMsToS(cobRevision.timestamp),
  }

  return revision
}

function mapCobCommentToComment(commentId: string, cobComment: CobComment): Comment {
  const comment: Comment = {
    id: commentId,
    author: resolveIdentityFromNId(cobComment.author),
    body: cobComment.body,
    edits: cobComment.edits.map(mapCobEditToEdit),
    embeds: cobComment.edits.at(-1)?.embeds ?? [],
    resolved: cobComment.resolved,
    reactions: mapCobCommentReactionsToReactions(cobComment.reactions),
    location: cobComment.location,
    replyTo: cobComment.replyTo,
    timestamp: convertMsToS(cobComment.edits[0]?.timestamp ?? 0),
  }

  return comment
}

function mapCobReviewToReview(cobReview: CobReview): Review {
  const reviewComments = cobReview.comments.timeline
    .map((commentId) => cobReview.comments.comments[commentId])
    .filter(Boolean)

  const review: Review = {
    author: resolveIdentityAlias(cobReview.author),
    verdict: cobReview.verdict ?? undefined,
    summary: cobReview.summary.at(-1)?.body,
    comment: reviewComments.find((comment) => !comment.location)?.body,
    inline: reviewComments
      .filter((comment) => comment.location)
      .map((comment) => ({
        location: comment.location as NonNullable<Comment['location']>,
        comment: comment.body,
        timestamp: convertMsToS(comment.edits[0]?.timestamp ?? 0),
      })),
    timestamp: convertMsToS(cobReview.timestamp),
  }

  return review
}

function mapCobReactionToReaction(cobReaction: CobReaction): Reaction & {
  location?: Comment['location']
} {
  return {
    emoji: cobReaction.emoji,
    authors: cobReaction.authors.map(resolveIdentityFromNId),
    location: cobReaction.location ?? undefined,
  }
}

/**
 * Maps a comment's `[authorNId, emoji]` reaction tuples to the httpd-shaped `Reaction` list,
 * grouping the per-author tuples by emoji so each emoji carries all of its authors.
 */
function mapCobCommentReactionsToReactions(cobReactions: CobCommentReaction[]): Reaction[] {
  const authorsByEmoji = new Map<string, RadicleIdentity[]>()
  for (const [author, emoji] of cobReactions) {
    const authors = authorsByEmoji.get(emoji) ?? []
    authors.push(resolveIdentityFromNId(author))
    authorsByEmoji.set(emoji, authors)
  }

  return [...authorsByEmoji].map(([emoji, authors]) => ({ emoji, authors }))
}

function mapCobEditToEdit(cobEdit: CobEdit): Edit {
  const edit: Edit = {
    author: resolveIdentityFromNId(cobEdit.author),
    body: cobEdit.body,
    embeds: cobEdit.embeds,
    timestamp: convertMsToS(cobEdit.timestamp),
  }

  return edit
}

function resolveIdentityFromNId(nid: NId): RadicleIdentity {
  return resolveIdentityAlias({ id: `did:key:${nid}` })
}

/**
 * Fills in an identity's `alias` from the local node's address book (see `aliasStore`), since
 * `rad cob show` (unlike httpd) resolves no aliases. The authoritative `rad self` alias wins
 * for the local user. Identities still unknown to the address book stay alias-less and the UI
 * falls back to their shortened id.
 */
function resolveIdentityAlias(identity: RadicleIdentity): RadicleIdentity {
  const localIdentity = useEnvStore().localIdentity
  if (localIdentity && identity.id === localIdentity.DID && localIdentity.alias) {
    return { ...identity, alias: localIdentity.alias }
  }

  const alias = useAliasStore().resolveAlias(identity.id.replace(/^did:key:/, ''))

  return alias ? { ...identity, alias } : identity
}

function convertMsToS(timestampMs: number): number {
  // Floor to whole seconds so locally-loaded timestamps match httpd's integer-second
  // serialization (see the mapping note above), keeping the two data sources interchangeable.
  return Math.floor(timestampMs / 1000)
}

function createErrorFromExec(
  contextMsg: string,
  execResult: { errorCode?: string | number; stderr?: string; stdout?: string },
): Error {
  const details = execResult.stderr || execResult.stdout || `code ${execResult.errorCode}`
  log(contextMsg, 'error', details)

  return new Error(`${contextMsg}: ${details}`)
}
