import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFirstAndLatestRevisions } from '../../../src/helpers/patch'
import { loadPatchFilechanges } from '../../../src/helpers/patchData'
import { buildPatchMultiFileDiffResources } from '../../../src/helpers/patchFileSystemProvider'

vi.mock('../../../src/stores', () => ({ useEnvStore: vi.fn() }))
vi.mock('../../../src/utils', () => ({ log: vi.fn() }))
vi.mock('../../../src/helpers/patch', () => ({ getFirstAndLatestRevisions: vi.fn() }))
vi.mock('../../../src/helpers/patchData', () => ({
  loadPatchFilechanges: vi.fn(),
  loadFileBytesAtCommit: vi.fn(),
}))

const getRevsMock = getFirstAndLatestRevisions as unknown as Mock
const loadFilechangesMock = loadPatchFilechanges as unknown as Mock

const rid = 'rad:zABC' as const
const oldCommit = 'base000'
const newCommit = 'head111'

beforeEach(() => {
  vi.clearAllMocks()
  getRevsMock.mockReturnValue({ latestRevision: { base: oldCommit, oid: newCommit } })
})

describe('buildPatchMultiFileDiffResources()', () => {
  it('maps each changed file to [label, original, modified], omitting the missing side', () => {
    loadFilechangesMock.mockReturnValue({
      data: [
        { status: 'modified', path: 'src/a.ts', oldPath: 'src/a.ts' },
        { status: 'added', path: 'src/new.ts', oldPath: 'src/new.ts' },
        { status: 'deleted', path: 'src/old.ts', oldPath: 'src/old.ts' },
        { status: 'moved', path: 'src/to.ts', oldPath: 'src/from.ts' },
      ],
    })

    const { resources, error } = buildPatchMultiFileDiffResources(rid, {} as never)

    expect(error).toBeUndefined()
    expect(resources).toHaveLength(4)

    // modified: both sides present, old from base commit, new from head commit
    const [labelMod, originalMod, modifiedMod] = resources![0]!

    expect(labelMod.scheme).toBe('radicle-patch')
    expect(labelMod.path).toBe('/src/a.ts')
    expect(originalMod!.path).toBe('/src/a.ts')
    expect(JSON.parse(originalMod!.query)).toMatchObject({ rid, commit: oldCommit })
    expect(JSON.parse(modifiedMod!.query)).toMatchObject({ rid, commit: newCommit })

    // added: no original (left) side
    const [, originalAdd, modifiedAdd] = resources![1]!

    expect(originalAdd).toBeUndefined()
    expect(modifiedAdd!.path).toBe('/src/new.ts')

    // deleted: no modified (right) side
    const [, originalDel, modifiedDel] = resources![2]!

    expect(originalDel!.path).toBe('/src/old.ts')
    expect(modifiedDel).toBeUndefined()

    // moved: original tracks the old path, modified the new path
    const [, originalMov, modifiedMov] = resources![3]!

    expect(originalMov!.path).toBe('/src/from.ts')
    expect(modifiedMov!.path).toBe('/src/to.ts')
  })

  it('surfaces the error (and no resources) when loading the filechanges fails', () => {
    const failure = new Error('git diff blew up')
    loadFilechangesMock.mockReturnValue({ error: failure })

    const { resources, error } = buildPatchMultiFileDiffResources(rid, {} as never)

    expect(error).toBe(failure)
    expect(resources).toBeUndefined()
  })

  it('returns an empty resource list when the patch has no changed files', () => {
    loadFilechangesMock.mockReturnValue({ data: [] })

    const { resources } = buildPatchMultiFileDiffResources(rid, {} as never)

    expect(resources).toEqual([])
  })
})
