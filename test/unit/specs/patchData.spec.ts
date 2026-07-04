import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execRad } from '../../../src/helpers/exec'
import { loadFileBytesAtCommit, loadPatches } from '../../../src/helpers/patchData'

vi.mock('../../../src/helpers/exec', () => ({ execRad: vi.fn(), execGit: vi.fn() }))
vi.mock('../../../src/stores', () => ({
  useEnvStore: vi.fn(() => ({ localIdentity: undefined })),
  useAliasStore: vi.fn(() => ({
    // authorA's node id -> alias; anyone else unknown to the address book
    resolveAlias: (nid: string) =>
      nid === 'z6MkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' ? 'alice' : undefined,
  })),
}))
vi.mock('../../../src/utils', () => ({ log: vi.fn(), assertUnreachable: vi.fn() }))
vi.mock('../../../src/helpers/fetchFromHttpd', () => ({ fetchFromHttpd: vi.fn() }))

const execRadMock = execRad as unknown as Mock

const patchId = '1111111111111111111111111111111111111111'
const authorA = 'z6MkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const authorB = 'z6MkBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

// A minimal patch COB whose single revision has one discussion comment carrying two
// `[authorNId, emoji]` reaction tuples. `rad cob show` serializes comment reactions as
// tuples (not objects), unlike revision reactions — the mapping must not treat them alike.
function patchCobFixture(overrides?: {
  reviews?: Record<string, unknown>
  revisionTimestamp?: number
}): string {
  const cob = {
    title: 'a patch',
    author: { id: `did:key:${authorA}` },
    state: { status: 'open' },
    target: 'delegates',
    labels: [],
    merges: {},
    assignees: [],
    revisions: {
      [patchId]: {
        id: patchId,
        author: { id: `did:key:${authorA}` },
        description: [{ author: authorA, timestamp: 1000, body: 'desc', embeds: [] }],
        base: 'base0',
        oid: 'oid0',
        reactions: [],
        discussion: {
          comments: {
            c1: {
              author: authorA,
              reactions: [
                [authorA, '👍'],
                [authorB, '👍'],
              ],
              resolved: false,
              body: 'nice',
              edits: [{ author: authorA, timestamp: 2000, body: 'nice', embeds: [] }],
            },
          },
          timeline: ['c1'],
        },
        reviews: overrides?.reviews ?? {},
        timestamp: overrides?.revisionTimestamp ?? 1000,
      },
    },
  }

  return JSON.stringify(cob)
}

function reviewFixture() {
  return {
    id: 'review1',
    author: { id: `did:key:${authorA}` },
    verdict: 'accept',
    summary: [{ author: authorA, timestamp: 3000, body: 'lgtm', embeds: [] }],
    comments: { comments: {}, timeline: [] },
    timestamp: 3000,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  execRadMock.mockImplementation((args: string[]) => {
    if (args.includes('list')) {
      return { stdout: patchId }
    }
    if (args.includes('show')) {
      return { stdout: patchCobFixture() }
    }

    return { stdout: '' }
  })
})

describe('loadPatches() from the local node', () => {
  it('maps a patch with comment reactions without throwing', () => {
    const { data, error } = loadPatches(`rad:z123`)

    expect(error).toBeUndefined()
    expect(data).toHaveLength(1)
  })

  it('resolves author aliases from the address book', () => {
    const { data } = loadPatches(`rad:z123`)

    expect(data?.[0]?.author.alias).toBe('alice')
  })

  // Comment reactions are `[authorNId, emoji]` tuples; a regression here silently threw
  // `Cannot read properties of undefined (reading 'map')`, failing the whole patch listing.
  it('groups per-author comment reaction tuples by emoji', () => {
    const { data } = loadPatches(`rad:z123`)

    const reactions = data?.[0]?.revisions[0]?.discussions[0]?.reactions

    expect(reactions).toEqual([
      {
        emoji: '👍',
        // authorA is known to the (mocked) address book, authorB is not
        authors: [{ id: `did:key:${authorA}`, alias: 'alice' }, { id: `did:key:${authorB}` }],
      },
    ])
  })

  // A redacted review serializes as `null` in the reviews map (like redacted revisions do);
  // it must be skipped, not crash the whole listing (the same failure class this branch set
  // out to fix).
  it('skips a redacted (null) review instead of failing the load', () => {
    execRadMock.mockImplementation((args: string[]) => {
      if (args.includes('list')) {
        return { stdout: patchId }
      }
      if (args.includes('show')) {
        return { stdout: patchCobFixture({ reviews: { r1: null, r2: reviewFixture() } }) }
      }

      return { stdout: '' }
    })

    const { data, error } = loadPatches(`rad:z123`)

    expect(error).toBeUndefined()
    expect(data?.[0]?.revisions[0]?.reviews).toHaveLength(1)
  })

  // A redacted patch COB serializes as a `null` line from `rad cob show`; skipping it keeps
  // one redacted patch from failing the whole batch of requested ids.
  it('skips a redacted (null) patch COB instead of failing the whole batch', () => {
    const patchId2 = '2222222222222222222222222222222222222222'
    execRadMock.mockImplementation((args: string[]) => {
      if (args.includes('list')) {
        return { stdout: `${patchId}\n${patchId2}` }
      }
      if (args.includes('show')) {
        return { stdout: `null\n${patchCobFixture()}` }
      }

      return { stdout: '' }
    })

    const { data, error } = loadPatches(`rad:z123`)

    expect(error).toBeUndefined()
    expect(data).toHaveLength(1)
  })

  // Timestamps must be floored to whole seconds to match httpd's integer-second serialization.
  it('floors millisecond timestamps to whole seconds', () => {
    execRadMock.mockImplementation((args: string[]) => {
      if (args.includes('list')) {
        return { stdout: patchId }
      }
      if (args.includes('show')) {
        return { stdout: patchCobFixture({ revisionTimestamp: 1999 }) }
      }

      return { stdout: '' }
    })

    const { data } = loadPatches(`rad:z123`)

    expect(data?.[0]?.revisions[0]?.timestamp).toBe(1)
  })
})

describe('loadFileBytesAtCommit() from the local node', () => {
  // `getStorageRepoPath` used to throw when the node home was unresolvable, escaping the
  // `XOR<{data},{error}>` contract and rejecting the tree provider's `getChildren`.
  it('returns an error object (never throws) when the node home cannot be resolved', () => {
    execRadMock.mockReturnValue({ errorCode: 1, stderr: 'no node home' })

    const { data, error } = loadFileBytesAtCommit(`rad:z123`, 'commit0', 'file.ts')

    expect(data).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
  })
})
