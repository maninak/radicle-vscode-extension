import { access, constants } from 'node:fs'
import { homedir } from 'node:os'
import { type Disposable, RelativePattern, Uri, workspace } from 'vscode'
import {
  getAbsolutePathToDefaultRadBinaryDirectory,
  getConfig,
  getResolvedPathToNodeHome,
  getResolvedPathToRadBinary,
  isRadCliInstalled,
  isRadInitialized,
  radBinaryFilename,
} from '.'
import { useEnvStore, useGitStore } from '../stores'
import { getRepoRoot, getWorkspaceFolderPaths, log, setWhenClauseContext } from '../utils'
import { validateRadCliInstallation, validateRadicleIdentityAuthentication } from '../ux'

interface FileWatcherConfig {
  glob:
    | Parameters<typeof workspace.createFileSystemWatcher>['0']
    | (() => Parameters<typeof workspace.createFileSystemWatcher>['0'])
  handler: () => unknown
  immediate?: boolean
}

// TODO: maninak call setWhenClauseContext inside the stores as an effect??
// TODO: maninak replace `getRepoRoot()` with gitStore access?
function getNotInWorkspaceFileWatchers(): FileWatcherConfig[] {
  return [
    {
      glob: () =>
        new RelativePattern(
          // `getRepoRoot()` will return undefined if user opens the extension on
          // a non-git-initialized folder, pointing our watcher to the wrong path.
          // We're doing a best effort using the first workspace folder instead
          // in case it is created later.
          Uri.file(`${getRepoRoot() ?? getWorkspaceFolderPaths()?.[0] ?? ''}/.git/`),
          'config',
        ),
      handler: () => {
        useEnvStore().refreshCurrentRepoId() // doesn't _need_ to be immediate but ok for now
        // a branch's upstream tracking lives in `.git/config` and may be (re-)configured
        // after HEAD already changed, e.g. by `rad patch checkout`
        useGitStore().refreshCurentBranch()
        setWhenClauseContext('radicle.isRadInitialized', isRadInitialized())
      },
      immediate: true,
    },
    {
      glob: () =>
        new RelativePattern(
          // `getRepoRoot()` will return undefined if user opens the extension on
          // a non-git-initialized folder, pointing our watcher to the wrong path.
          // We're doing a best effort using the first workspace folder instead
          // in case it is created later.
          Uri.file(`${getRepoRoot() ?? getWorkspaceFolderPaths()?.[0] ?? ''}/.git/`),
          'HEAD',
        ),
      handler: () => {
        useGitStore().refreshCurentBranch()
      },
    },
    {
      glob: new RelativePattern(
        Uri.file(`${getResolvedPathToNodeHome()}/keys/`),
        'radicle.pub',
      ),
      handler: () => {
        useEnvStore().refreshLocalIdentity()
      },
      immediate: true,
    },
    // installation with script from https://radicle.dev/install
    {
      glob: new RelativePattern(
        Uri.file(`${getAbsolutePathToDefaultRadBinaryDirectory()}/`),
        radBinaryFilename,
      ),
      handler: onRadCliInstallationChanged,
    },
    // installation with package manager
    (() => {
      let pathToRadBinaryDirWithTrailingSlash: `${string}/` | undefined
      // obscure platforms have no known rad path; they fall through to `default` and rely on
      // user config
      // eslint-disable-next-line ts/switch-exhaustiveness-check -- see comment above
      switch (process.platform) {
        case 'linux':
          pathToRadBinaryDirWithTrailingSlash = '/usr/bin/'
          break
        case 'darwin':
          // must be pre-expanded: neither VS Code watchers nor fs APIs expand `~` themselves
          pathToRadBinaryDirWithTrailingSlash = `${homedir()}/.cargo/bin/`
          break
        default:
          log(
            `Unsupported platform "${process.platform}" for automatic detection of rad binary.`,
            'warn',
          )
          break
      }

      if (pathToRadBinaryDirWithTrailingSlash) {
        return {
          glob: new RelativePattern(
            Uri.file(pathToRadBinaryDirWithTrailingSlash),
            radBinaryFilename,
          ),
          handler: onRadCliInstallationChanged,
        }
      }

      return undefined
    })(),
    // installation into some user-selected directory
    (() => {
      const customPathToRadBinaryDirWithTrailingSlash = getConfig(
        'radicle.advanced.pathToRadBinary',
      )?.replace(new RegExp(`${radBinaryFilename}$`), '')
      if (customPathToRadBinaryDirWithTrailingSlash) {
        return {
          glob: new RelativePattern(
            Uri.file(customPathToRadBinaryDirWithTrailingSlash),
            radBinaryFilename,
          ),
          handler: onRadCliInstallationChanged,
        }
      }

      return undefined
    })(),
  ].filter(Boolean) satisfies FileWatcherConfig[]
}

let activeFileWatchers: Disposable[] = []
let activePollTimers: NodeJS.Timeout[] = []
const pollIntervalMs = 3_000

/**
 * Registers all handlers to be called whenever any watched files get changed. Safe to call
 * repeatedly. Any previously registered watchers are disposed first, so a changed config
 * (e.g. `pathToRadBinary`) re-points them instead of leaking duplicates.
 */
export function registerAllFileWatchers() {
  activeFileWatchers.forEach((watcher) => {
    watcher.dispose()
  })
  activeFileWatchers = []
  activePollTimers.forEach((timer) => clearTimeout(timer))
  activePollTimers = []

  const fileWatchers = getNotInWorkspaceFileWatchers()
  fileWatchers.forEach((fileWatcherConfig) => {
    watchFileNotInWorkspace(fileWatcherConfig)
  })

  /*
   * Node.js file watchers don't fire for a path whose parent dir didn't exist at registration
   * (e.g. the Radicle suite or an identity gets created after we started watching), so we poll
   * to detect such after-the-fact creations.
   */
  if (!isRadCliInstalled()) {
    pollUntilAccessible(getResolvedPathToRadBinary(), () => {
      onRadCliInstallationChanged()
      isRadCliInstalled() && registerAllFileWatchers()
    })
  } else if (!useEnvStore().localIdentity) {
    const pathToIdentity = `${getResolvedPathToNodeHome()}/keys/radicle.pub`
    pollUntilAccessible(pathToIdentity, () => {
      useEnvStore().refreshLocalIdentity()
      validateRadicleIdentityAuthentication({ minimizeUserNotifications: true })
      useEnvStore().localIdentity && registerAllFileWatchers()
    })
  }
}

// Polls until `path` becomes readable, then runs `onAccessible`. Re-schedules itself while the
// path is still missing (rather than checking only once) so a creation later than the first
// tick is not missed. All pending polls are cleared on the next `registerAllFileWatchers`.
function pollUntilAccessible(path: string, onAccessible: () => void): void {
  const timer = setTimeout(() => {
    access(path, constants.R_OK, (err) => {
      if (err) {
        pollUntilAccessible(path, onAccessible)
      } else {
        onAccessible()
      }
    })
  }, pollIntervalMs)
  activePollTimers.push(timer)
}

// A hacky and specialized wrapper. If it doesn't meet your use case, consider
// going manual instead of adapting it.
function watchFileNotInWorkspace({ glob, handler, immediate }: FileWatcherConfig): void {
  immediate && handler()

  const resolvedGlobPattern = typeof glob === 'function' ? glob() : glob

  const watcher = workspace.createFileSystemWatcher(resolvedGlobPattern)
  watcher.onDidCreate(handler)
  watcher.onDidChange(handler)
  watcher.onDidDelete(handler)

  activeFileWatchers.push(watcher)
  useEnvStore().extCtx.subscriptions.push(watcher)
}

function onRadCliInstallationChanged() {
  validateRadCliInstallation() &&
    setWhenClauseContext('radicle.isRadInitialized', isRadInitialized())
}
