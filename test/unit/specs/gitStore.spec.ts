import type { Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '../../../src/stores/gitStore'
import { getCurrentGitBranchAndUpstream } from '../../../src/utils'

vi.mock('../../../src/utils', () => ({
  getCurrentGitBranchAndUpstream: vi.fn(),
}))

const getCurrentGitBranchAndUpstreamMock = getCurrentGitBranchAndUpstream as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
})

describe('gitStore', () => {
  it('exposes the current branch and its upstream', () => {
    getCurrentGitBranchAndUpstreamMock.mockReturnValue({
      branch: 'feat/75_fix-pesky-bug',
      upstream: 'rad/patches/abc123',
    })

    const store = useGitStore()

    expect(store.currentBranch).toBe('feat/75_fix-pesky-bug')
    expect(store.currentUpstreamBranch).toBe('rad/patches/abc123')
  })

  it('exposes an undefined upstream for a branch without one', () => {
    getCurrentGitBranchAndUpstreamMock.mockReturnValue({ branch: 'main', upstream: undefined })

    const store = useGitStore()

    expect(store.currentBranch).toBe('main')
    expect(store.currentUpstreamBranch).toBeUndefined()
  })

  it('resolves branch and upstream with a single git read', () => {
    getCurrentGitBranchAndUpstreamMock.mockReturnValue({
      branch: 'main',
      upstream: 'rad/main',
    })

    const store = useGitStore()
    void store.currentBranch
    void store.currentUpstreamBranch

    expect(getCurrentGitBranchAndUpstreamMock).toHaveBeenCalledTimes(1)
  })

  it('reflects an out-of-band upstream change after refreshCurentBranch', () => {
    // e.g. `rad patch checkout` run in a terminal reconfigures the upstream out of band
    getCurrentGitBranchAndUpstreamMock.mockReturnValue({ branch: 'main', upstream: undefined })

    const store = useGitStore()

    expect(store.currentUpstreamBranch).toBeUndefined()

    getCurrentGitBranchAndUpstreamMock.mockReturnValue({
      branch: 'patch/abc123',
      upstream: 'rad/patches/abc123',
    })
    store.refreshCurentBranch()

    expect(store.currentBranch).toBe('patch/abc123')
    expect(store.currentUpstreamBranch).toBe('rad/patches/abc123')
  })
})
