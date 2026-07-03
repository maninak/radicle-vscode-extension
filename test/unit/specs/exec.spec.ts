import type { Mock } from 'vitest'
import { execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { execRad } from '../../../src/helpers/exec'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }))
vi.mock('../../../src/stores', () => ({
  useEnvStore: vi.fn(() => ({ resolvedAbsolutePathToRadBinary: '/fake/rad' })),
}))
vi.mock('../../../src/utils', () => ({
  getWorkspaceFolderPaths: vi.fn(() => ['/fake/workspace']),
  log: vi.fn(),
  truncateKeepWords: (str: string) => str,
}))
vi.mock('../../../src/helpers/config', () => ({ getConfig: vi.fn(() => undefined) }))

const execFileSyncMock = execFileSync as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  execFileSyncMock.mockReturnValue('')
})

describe('execRad', () => {
  // `rad cob show` for a whole repo's patches can emit several MB. Node's default 1MB
  // `maxBuffer` overflows with ENOBUFS, which used to surface as "Failed listing patches".
  it('passes a maxBuffer large enough for multi-MB `rad cob show` output', () => {
    execRad(['cob', 'show', '--repo', 'rad:z123', '--type', 'xyz.radicle.patch'])

    const passedOpts = execFileSyncMock.mock.calls[0]?.[2] as { maxBuffer?: number }

    expect(passedOpts.maxBuffer).toBeGreaterThanOrEqual(64 * 1024 * 1024)
  })

  it('returns the ENOBUFS errorCode instead of throwing when output overflows the buffer', () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync /fake/rad ENOBUFS'), { code: 'ENOBUFS' })
    })

    const result = execRad(['cob', 'show', '--repo', 'rad:z123'])

    expect(result.errorCode).toBe('ENOBUFS')
    expect(result.stdout).toBeUndefined()
  })

  it('does not retry by default', () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('boom'), { status: 1 })
    })

    const result = execRad(['self'])

    expect(execFileSyncMock).toHaveBeenCalledTimes(1)
    expect(result.errorCode).toBe(1)
  })

  it('retries a failing command up to the configured count, then returns the last error', () => {
    execFileSyncMock.mockImplementation(() => {
      throw Object.assign(new Error('database is locked'), { status: 1 })
    })

    const result = execRad(['cob', 'list'], { retryOnFailure: { retries: 3, intervalMs: 0 } })

    // 1 initial attempt + 3 retries
    expect(execFileSyncMock).toHaveBeenCalledTimes(4)
    expect(result.errorCode).toBe(1)
  })

  it('stops retrying as soon as an attempt succeeds', () => {
    let attempt = 0
    execFileSyncMock.mockImplementation(() => {
      attempt++
      if (attempt < 3) {
        throw Object.assign(new Error('database is locked'), { status: 1 })
      }

      return 'ok'
    })

    const result = execRad(['cob', 'list'], { retryOnFailure: { retries: 5, intervalMs: 0 } })

    expect(execFileSyncMock).toHaveBeenCalledTimes(3)
    expect(result.stdout).toBe('ok')
  })
})
