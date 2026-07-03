import { platform, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export const testingWorkspacePath = join(tmpdir(), 'rad-e2e-workspace')

export const rootDir = join(__dirname, '../..')

/**
 * The path to a disposable directory used as `$HOME` for the entire e2e run. Kept short
 * because a node's control socket lives at `<home>/.radicle/node/control.sock`, and macOS caps
 * unix-domain socket paths at 104 bytes; under macOS's long `os.tmpdir()` a verbose name
 * pushesthat socket over the limit, so `rad` cannot reach the node (e.g. `rad clone` fails).
 */
export const emulatedHomePath = join(tmpdir(), 'rad-e2e-home')
export const nodeHomePath = join(emulatedHomePath, '.radicle')
export const radicleBinPath = join(nodeHomePath, 'bin')
export const radCliPath = join(radicleBinPath, 'rad')
export const httpdPath = join(radicleBinPath, 'radicle-httpd')
/** Where the Radicle CLI binary is moved to in order to emulate it being uninstalled. */
export const backupRadCliPath = `${radCliPath}.uninstalled`

export const httpdHost = '127.0.0.1'
// base for per-worker httpd ports (see `getWorkerHttpdPort`); no httpd listens on this port
// itself anymore, the suite no longer runs a shared httpd
export const httpdPort = 8080

export const nodePidFilePath = join(emulatedHomePath, 'radicle-node.pid')

export const sandboxedPath = `${radicleBinPath}${delimiter}${process.env['PATH'] ?? ''}`
export const radCliVersion = process.env['RADICLE_VERSION']?.trim() || undefined
export const httpdVersion = process.env['RADICLE_HTTPD_VERSION']?.trim() || 'latest'

export const supportedVscodeVersion =
  // eslint-disable-next-line ts/no-require-imports, ts/no-unsafe-member-access
  (require('../../package.json').engines.vscode as string).replace(/^\^/, '')

export const wdioCachePath = join(rootDir, 'node_modules', '.cache', 'wdio')
export const chromedriverPath = join(
  wdioCachePath,
  platform() === 'win32' ? 'chromedriver.exe' : 'chromedriver',
)
export const wdioVideoPath = join(rootDir, 'node_modules', '.wdio-video')

/** Matches every per-worker home, so a crashed run's leftovers get swept on the next setup. */
export const workerHomeNamePattern = /^rad-e2e-home-\d+$/

/** Matches every per-worker workspace, swept alongside the homes. */
export const workerWorkspaceNamePattern = /^rad-e2e-workspace-\d+$/
