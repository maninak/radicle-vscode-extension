import type { AugmentedPatch, DId } from '../types'

export interface PatchDetailWebviewInjectedState {
  kind: 'webview-patch-detail'
  id: number
  /**
   * The panel's role. Only set with the state injected at panel creation (never with
   * subsequent state update pushes, which must not overwrite it), so that the webview
   * persists it and the role survives an editor restart.
   */
  panelKind?: 'preview' | 'standalone'
  state: {
    patch: AugmentedPatch & { isCheckedOut: boolean }
    timeLocale: Parameters<Date['toLocaleDateString']>['0']
    delegates: DId[]
    defaultBranch: string
    localIdentity?: { id: `did:key:${string}`; alias: string }
  }
}
