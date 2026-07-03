import { sep } from 'node:path'
import { effect, stop } from '@vue/reactivity'
import { commands, ProgressLocation, type QuickPickItem, Uri, window } from 'vscode'
import { execRad } from '../helpers'
import { type RepoListItem, useRepoListStore } from '../stores'
import { getRepoRoot, log, showLog } from '../utils'
import { notifyUserAboutFetchError } from './httpdConnection'

interface RepoQuickPickItem extends QuickPickItem {
  rid: string
}

export async function pickAndCloneRadicleRepo(): Promise<void> {
  const selectedRepo = await pickRepoToClone()
  if (!selectedRepo) {
    return
  }

  const selectedRid = selectedRepo.rid
  const repoName = selectedRepo.label

  const repoRoot = getRepoRoot()
  const oneFolderUpFromRepoRoot = repoRoot?.split(sep).slice(0, -1).join(sep)
  // Test seam: e2e runs cannot drive the native folder picker, so the e2e harness injects the
  // clone destination through this env var. It is never set in normal use.
  const e2eCloneParentDirPath = process.env['RAD_E2E_CLONE_PARENT_DIR']
  const cloneParentDir = e2eCloneParentDirPath
    ? Uri.file(e2eCloneParentDirPath)
    : (
        await window.showOpenDialog({
          title: `Choose a folder to clone "${repoName}" into`,
          openLabel: 'Select Repository Location',
          canSelectMany: false,
          canSelectFiles: false,
          canSelectFolders: true,
          defaultUri: oneFolderUpFromRepoRoot ? Uri.file(oneFolderUpFromRepoRoot) : undefined,
        })
      )?.[0]
  if (!cloneParentDir) {
    return
  }

  const cloneTargetDir = Uri.joinPath(cloneParentDir, repoName)

  const msgSuffix = `repo "${repoName}" with id "${selectedRid}" into "${cloneTargetDir.fsPath}"`
  const didClone = await window.withProgress(
    {
      location: ProgressLocation.Window,
      title: `‎$(radicle-logo) Cloning ${msgSuffix}…`,
    },
    // eslint-disable-next-line require-await
    async () => {
      // TODO: maninak make rad clone non-blocking
      const { errorCode } = execRad(
        ['clone', selectedRid, cloneTargetDir.fsPath, '--no-confirm'],
        {
          cwd: cloneParentDir.fsPath,
          timeout: 120_000,
          shouldLog: true,
        },
      )

      return !errorCode
    },
  )
  if (!didClone) {
    const msg = `Failed cloning ${msgSuffix}`
    log(msg, 'error')

    const buttonOutput = 'Show output'
    const shouldShowOutput = await window.showErrorMessage(msg, buttonOutput)
    shouldShowOutput && showLog()

    return
  }

  const msg = `Cloned ${msgSuffix}`
  log(msg, 'info')

  const buttonOpenInVscode = 'Open in new window'
  const shouldOpenInNewWindow = await window.showInformationMessage(msg, buttonOpenInVscode)
  shouldOpenInNewWindow &&
    commands.executeCommand('vscode.openFolder', cloneTargetDir, { forceNewWindow: true })
}

/**
 * Offers the machine-local cache of cloneable repos immediately, while a throttled background
 * refresh (see `repoListStore`) keeps it current: the picker shows a spinner and its items
 * grow live as fresh pages arrive. Notifies the user of a fetch error only when there's
 * nothing cached to offer, so being offline still lets them clone from cache.
 *
 * @returns the repo the user picked, or `undefined` if they dismissed the picker.
 */
async function pickRepoToClone(): Promise<RepoQuickPickItem | undefined> {
  const repoListStore = useRepoListStore()

  const quickPick = window.createQuickPick<RepoQuickPickItem>()
  quickPick.placeholder = 'Choose a Radicle repo to clone locally'
  quickPick.matchOnDescription = true
  quickPick.matchOnDetail = true
  quickPick.ignoreFocusOut = true

  // `getRepos()` is already sorted most-seeded-first and capped by the store, so just map it.
  let isPickerOpen = true
  const syncPickerToStore = effect(() => {
    quickPick.busy = repoListStore.isRefreshing
    quickPick.items = repoListStore.getRepos().map(toRepoItem)
  })
  quickPick.show()

  // Refresh in the background so picking a cached repo isn't blocked on the full fetch.
  // Surface a fetch error only while the picker is still open with nothing to offer, so being
  // offline still lets the user clone from cache and a late failure never toasts after they've
  // moved on.
  void repoListStore.refreshRepoList().then((result) => {
    if (isPickerOpen && result?.error && repoListStore.getRepos().length === 0) {
      notifyUserAboutFetchError(result.error)
      quickPick.hide()
    }
  })

  const selectedRepo = await new Promise<RepoQuickPickItem | undefined>((resolve) => {
    quickPick.onDidAccept(() => resolve(quickPick.selectedItems[0]))
    quickPick.onDidHide(() => resolve(undefined))
  })

  isPickerOpen = false
  stop(syncPickerToStore)
  quickPick.dispose()

  return selectedRepo
}

function toRepoItem(repo: RepoListItem): RepoQuickPickItem {
  return {
    label: repo.name,
    description: `$(radio-tower) ${repo.seeding} | ${repo.rid}`,
    detail: repo.description,
    rid: repo.rid,
  }
}
