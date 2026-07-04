import type { ExtensionContext } from 'vscode'
import {
  logExtensionActivated,
  pruneObsoleteTempFilesSearchExclude,
  registerAllCommands,
  registerAllConfigWatchers,
  registerAllFileSystemProviders,
  registerAllFileWatchers,
  registerAllViews,
  registerAllWebviewRestorators,
  registerExtensionHostAutoReload,
} from './helpers'
import { useAliasStore, useEnvStore } from './stores'
import { setWhenClauseContext } from './utils'
import { validateRadCliInstallation, validateRadicleIdentityAuthentication } from './ux'

export function activate(ctx: ExtensionContext) {
  useEnvStore().setExtensionContext(ctx)

  registerAllCommands()
  registerAllFileSystemProviders()
  registerAllViews()
  registerAllConfigWatchers()
  registerAllFileWatchers()
  registerAllWebviewRestorators()
  registerExtensionHostAutoReload()

  pruneObsoleteTempFilesSearchExclude()

  logExtensionActivated()
  validateRadCliInstallation({ minimizeUserNotifications: true })
  validateRadicleIdentityAuthentication({ minimizeUserNotifications: true })
  void useAliasStore().refreshAliases({ minimizeUserNotifications: true })

  setWhenClauseContext('radicle.isExtensionActivated', true)
}
