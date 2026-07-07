import type { AugmentedPatch } from '../types'
import { effect } from '@vue/reactivity'
import { window } from 'vscode'
import { usePatchStore } from '../stores'
import { getTimeAgo } from '../utils'
import { patchesTreeDataProvider, patchesViewId } from '../ux'

let patchesView: ReturnType<typeof registerPatchesView> | undefined

/**
 * Initializes and registers all Views dependent on a JS provider.
 */
export function registerAllViews(): void {
  patchesView = registerPatchesView()
}

function registerPatchesView() {
  const patchesView = window.createTreeView(patchesViewId, {
    treeDataProvider: patchesTreeDataProvider,
    showCollapseAll: true,
  })

  const updatePatchesViewDescription = effect(() => {
    // Read the reactive store deps unconditionally (no early return above this): a `visible`
    // guard here would run before these reads on the effect's first, hidden invocation, so the
    // effect would never subscribe to them and the header would only refresh on the slow
    // interval below instead of the moment patches load.
    const patchCount = usePatchStore().patches?.length
    const formattedPatchCount = typeof patchCount === 'number' ? `${patchCount} · ` : ''

    // TODO: maninak add "Updating..."

    const lastLoadedTs = usePatchStore().lastLoadedTs
    if (lastLoadedTs) {
      patchesView.description = `${formattedPatchCount}Updated ${getTimeAgo(lastLoadedTs)}`
    }
  })
  setInterval(() => {
    updatePatchesViewDescription()
  }, 30_000)

  return patchesView
}

/**
 * Switches VS Code views as necessary so that the given patch's entry is shown in
 * the Patches view. By default, it will attempt to scroll the patch into view
 * and select it.
 * @param patch - The patch to be revealed in the Patches view.
 * @param options - Optional options for how the patch should be revealed. To change this
 * behavior, set as follows:
 * - In order to not to select, set the option `select` to `false`.
 * - In order to focus, set the option `focus` to `true`.
 * - In order to expand the revealed element, set the option `expand` to `true`. To expand
 * recursively set `expand` to the number of levels to expand (max `3`).
 */
export function revealPatch(
  patch: AugmentedPatch,
  options?: Parameters<NonNullable<typeof patchesView>['reveal']>['1'],
): void {
  patchesView?.reveal(patch, options)
}
