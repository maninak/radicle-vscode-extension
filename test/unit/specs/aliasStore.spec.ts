import type { Mock } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAliasesFromNodeDb } from '../../../src/helpers'
import { useAliasStore } from '../../../src/stores/aliasStore'

const fakeStorageDir = join('fake', 'storage')

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))
vi.mock('../../../src/stores', () => ({
  useEnvStore: vi.fn(() => ({ extCtx: { globalStorageUri: { fsPath: fakeStorageDir } } })),
}))
vi.mock('../../../src/helpers', () => ({ readAliasesFromNodeDb: vi.fn() }))
vi.mock('../../../src/utils', () => ({ log: vi.fn() }))

const existsSyncMock = existsSync as unknown as Mock
const readFileSyncMock = readFileSync as unknown as Mock
const writeFileSyncMock = writeFileSync as unknown as Mock
const readAliasesFromNodeDbMock = readAliasesFromNodeDb as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  existsSyncMock.mockReturnValue(false)
})

describe('aliasStore', () => {
  it('resolves aliases seeded from the machine-local cache', () => {
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ z6MkA: 'alice' }))

    const store = useAliasStore()

    expect(store.resolveAlias('z6MkA')).toBe('alice')
    expect(store.resolveAlias('z6MkUnknown')).toBeUndefined()
  })

  it('refreshes from the address book, updates the map, and persists the cache', async () => {
    readAliasesFromNodeDbMock.mockResolvedValue(new Map([['z6MkB', 'bob']]))

    const store = useAliasStore()
    await store.refreshAliases()

    expect(store.resolveAlias('z6MkB')).toBe('bob')
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      join(fakeStorageDir, 'aliases.json'),
      JSON.stringify({ z6MkB: 'bob' }),
    )
  })

  it('keeps existing aliases when the address book read yields nothing', async () => {
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ z6MkA: 'alice' }))
    readAliasesFromNodeDbMock.mockResolvedValue(new Map())

    const store = useAliasStore()
    await store.refreshAliases()

    expect(store.resolveAlias('z6MkA')).toBe('alice')
    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })

  it('does not rewrite the cache when the address book is unchanged', async () => {
    existsSyncMock.mockReturnValue(true)
    readFileSyncMock.mockReturnValue(JSON.stringify({ z6MkA: 'alice' }))
    readAliasesFromNodeDbMock.mockResolvedValue(new Map([['z6MkA', 'alice']]))

    const store = useAliasStore()
    await store.refreshAliases()

    expect(writeFileSyncMock).not.toHaveBeenCalled()
  })
})
