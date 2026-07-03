import type { Mock } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exec } from '../../../src/helpers'
import { getValidatedPathToRadBinaryWhenAliased } from '../../../src/helpers/config'
import { isRealFsPath } from '../../../src/utils'

vi.mock('../../../src/helpers', () => ({ exec: vi.fn() }))
vi.mock('../../../src/utils', () => ({
  isRealFsPath: vi.fn(),
  assertUnreachable: vi.fn(),
  removeTrailingSlashes: vi.fn(),
  log: vi.fn(),
}))

const execMock = exec as unknown as Mock<(cmd: string) => string | undefined>
const isRealFsPathMock = isRealFsPath as unknown as Mock<(path: string) => boolean>

const PATH_PROP_KEY = 'radicle.advanced.pathToRadBinary'

interface ConfigContribution {
  properties?: Record<string, { pattern?: string }>
}

function readPathToRadBinaryPattern(): string {
  const pkgPath = fileURLToPath(new URL('../../../package.json', import.meta.url))
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    contributes: { configuration: ConfigContribution[] }
  }
  const owningConfig = pkg.contributes.configuration.find(
    (config) => config.properties?.[PATH_PROP_KEY]?.pattern,
  )
  const pattern = owningConfig?.properties?.[PATH_PROP_KEY]?.pattern
  if (!pattern) {
    throw new Error(`No validation pattern found for "${PATH_PROP_KEY}" in package.json`)
  }

  return pattern
}

describe('radicle.advanced.pathToRadBinary validation pattern', () => {
  const pattern = new RegExp(readPathToRadBinaryPattern())

  const acceptedPaths = [
    ['empty string (unset)', ''],
    ['posix absolute path', '/usr/local/bin/rad'],
    ['posix path under home', '/home/me/.radicle/bin/rad'],
    ['windows path with backslashes', 'C:\\Users\\me\\.cargo\\bin\\rad.exe'],
    ['windows path with forward slashes', 'C:/Users/me/.cargo/bin/rad.exe'],
    ['windows path with a lowercase drive letter', 'c:\\rad\\rad.exe'],
    ['windows path containing spaces', 'C:\\Program Files\\rad\\rad.exe'],
  ] as const

  const rejectedPaths = [
    ['posix path containing spaces', '/opt/my apps/rad'],
    ['bare windows drive', 'C:'],
    ['windows drive root only', 'C:\\'],
    ['a relative bin name', 'rad'],
    ['a UNC network path', '\\\\server\\share\\rad.exe'],
    ['a tilde-prefixed posix path', '~/.radicle/bin/rad'],
    ['a tilde path without separator', '~radicle/bin/rad'],
    ['a windows path with an illegal char', 'C:\\bad<name\\rad.exe'],
  ] as const

  it.each(acceptedPaths)('accepts %s', (_label, path) => {
    expect(pattern.test(path)).toBe(true)
  })

  it.each(rejectedPaths)('rejects %s', (_label, path) => {
    expect(pattern.test(path)).toBe(false)
  })
})

describe('getValidatedPathToRadBinaryWhenAliased()', () => {
  const realPlatform = process.platform

  function stubPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    isRealFsPathMock.mockReturnValue(true)
  })

  afterEach(() => {
    stubPlatform(realPlatform)
  })

  it('locates the binary with `which` on non-windows platforms', () => {
    stubPlatform('linux')
    execMock.mockImplementation((cmd) => (cmd === 'which rad' ? '/usr/local/bin/rad' : 'ok'))

    const resolved = getValidatedPathToRadBinaryWhenAliased()

    expect(execMock).toHaveBeenCalledWith('which rad')
    expect(execMock).not.toHaveBeenCalledWith('where rad')
    expect(resolved).toBe('/usr/local/bin/rad')
  })

  it('locates the binary with `where` on windows', () => {
    stubPlatform('win32')
    execMock.mockImplementation((cmd) =>
      cmd === 'where rad' ? 'C:\\Users\\me\\.cargo\\bin\\rad.exe' : 'ok',
    )

    const resolved = getValidatedPathToRadBinaryWhenAliased()

    expect(execMock).toHaveBeenCalledWith('where rad')
    expect(execMock).not.toHaveBeenCalledWith('which rad')
    expect(resolved).toBe('C:\\Users\\me\\.cargo\\bin\\rad.exe')
  })

  // Regression: `where` can return several matches, one per line. Passing the whole
  // multi-line blob on to the fs check makes it throw, so the alias would resolve to nothing
  // even when rad is installed. We keep only the first (highest-priority) match.
  it('uses the first match when `where` returns several lines', () => {
    stubPlatform('win32')
    const firstMatch = 'C:\\Users\\me\\.cargo\\bin\\rad.exe'
    const whereOutput = `${firstMatch}\r\nC:\\Users\\me\\scoop\\shims\\rad.cmd`
    execMock.mockImplementation((cmd) => (cmd === 'where rad' ? whereOutput : 'ok'))

    const resolved = getValidatedPathToRadBinaryWhenAliased()

    expect(isRealFsPathMock).toHaveBeenCalledWith(firstMatch)
    expect(resolved).toBe(firstMatch)
  })

  it('returns undefined when the locator finds nothing', () => {
    stubPlatform('linux')
    execMock.mockReturnValue(undefined)

    expect(getValidatedPathToRadBinaryWhenAliased()).toBeUndefined()
  })

  it('returns undefined when the located path is not a real binary', () => {
    stubPlatform('linux')
    execMock.mockImplementation((cmd) => (cmd === 'which rad' ? '/usr/local/bin/rad' : 'ok'))
    isRealFsPathMock.mockReturnValue(false)

    expect(getValidatedPathToRadBinaryWhenAliased()).toBeUndefined()
  })
})
