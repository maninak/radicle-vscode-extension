import type { Mock } from 'vitest'
import { tmpdir } from 'node:os'
import { sep } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationTarget, workspace } from 'vscode'
import { pruneObsoleteTempFilesSearchExclude } from '../../../src/helpers/migrations'

vi.mock('../../../src/utils', () => ({ log: vi.fn() }))

const getConfigurationMock = workspace.getConfiguration as unknown as Mock

// The exact glob older versions wrote to `search.exclude`, reconstructed the same way the
// (now-removed) `extTempDir` constant did.
const obsoleteGlob = `${tmpdir()}${sep}radicle${sep}**`

function mockSearchExclude(globalValue: Record<string, unknown> | undefined) {
  const update = vi.fn(async () => await Promise.resolve())
  const inspect = vi.fn(() => ({ globalValue }))
  getConfigurationMock.mockReturnValue({ inspect, update })

  return { update, inspect }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pruneObsoleteTempFilesSearchExclude()', () => {
  it('removes the obsolete glob from global search.exclude, keeping other entries', () => {
    const { update } = mockSearchExclude({ [obsoleteGlob]: true, '**/node_modules': true })

    pruneObsoleteTempFilesSearchExclude()

    expect(update).toHaveBeenCalledWith(
      'search.exclude',
      { '**/node_modules': true },
      ConfigurationTarget.Global,
    )
  })

  it('only ever touches the global value, never the effective merged config', () => {
    const { inspect, update } = mockSearchExclude({ [obsoleteGlob]: true })

    pruneObsoleteTempFilesSearchExclude()

    expect(inspect).toHaveBeenCalledWith('search.exclude')
    expect(update).toHaveBeenCalledWith('search.exclude', {}, ConfigurationTarget.Global)
  })

  it('does nothing when the obsolete glob is absent', () => {
    const { update } = mockSearchExclude({ '**/node_modules': true })

    pruneObsoleteTempFilesSearchExclude()

    expect(update).not.toHaveBeenCalled()
  })

  it('does nothing when there is no global search.exclude at all', () => {
    const { update } = mockSearchExclude(undefined)

    pruneObsoleteTempFilesSearchExclude()

    expect(update).not.toHaveBeenCalled()
  })
})
