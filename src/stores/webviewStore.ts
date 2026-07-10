import type { WebviewPanel } from 'vscode'
import type { Patch } from '../types'
import { effect, type ReactiveEffectRunner, ref, type Ref } from '@vue/reactivity'
import { createPinia, defineStore, setActivePinia } from 'pinia'
import {
  alignUiWithWebviewPatchDetailState,
  getStateForWebview,
  type PanelReuseCandidate,
} from '../helpers'
import { assertUnreachable } from '../utils'

setActivePinia(createPinia())

export const allWebviewIds = ['webview-patch-detail'] as const
/**
 * A collection of all our custom panel types under a (hopefully) a better name.
 * @see WebviewPanel.viewType
 */
export type WebviewId = (typeof allWebviewIds)[number]

interface TrackedPanel {
  webviewId: WebviewId
  /**
   * Identifier of the data (e.g. a patch id) the panel currently renders. A ref so that
   * retargeting the panel to different data re-triggers its state-pushing effect.
   */
  data: Ref<string>
  /**
   * Whether this is the designated reusable "preview" panel of its webviewId. At most one
   * live panel per webviewId can be the preview panel.
   */
  isPreview: boolean
  effectRunner: ReactiveEffectRunner
}

export const useWebviewStore = defineStore('webviewStore', () => {
  const trackedPanels = new Map<WebviewPanel, TrackedPanel>()

  function track(
    panel: WebviewPanel,
    webviewId: 'webview-patch-detail',
    data: Patch['id'],
    options?: { isPreview?: boolean },
  ): void
  function track(
    panel: WebviewPanel,
    webviewId: WebviewId,
    data: string,
    options?: { isPreview?: boolean },
  ): void {
    switch (webviewId) {
      case 'webview-patch-detail':
        {
          // enforce at most one live preview panel per webviewId (e.g. if multiple
          // serialized panels claim the role when restored after a restart)
          const isPreview = Boolean(options?.isPreview) && !findPreviewPanel(webviewId)
          const dataRef = ref(data)

          const effectRunner = effect(async () => {
            const stateForWebview = await getStateForWebview(webviewId, dataRef.value)
            alignUiWithWebviewPatchDetailState(panel, stateForWebview)
          })

          trackedPanels.set(panel, { webviewId, data: dataRef, isPreview, effectRunner })
        }
        break
      default:
        assertUnreachable(webviewId)
    }
  }

  function untrack(panel: WebviewPanel): boolean {
    // TODO: maninak uncomment code below when we've fixed panels getting insta-disposed.
    // const effectRunner = trackedPanels.get(panel)?.effectRunner
    // effectRunner && stop(effectRunner) // `stop` is from @vue/reactivity

    return trackedPanels.delete(panel)
  }

  /**
   * Points an already tracked panel to different data. Its state-pushing effect re-runs,
   * updating the webview's state, the panel title and its icon for the new data.
   */
  function retarget(panel: WebviewPanel, data: string): void {
    const trackedPanel = trackedPanels.get(panel)
    if (trackedPanel) {
      trackedPanel.data.value = data
    }
  }

  function getPanelData(panel: WebviewPanel): string | undefined {
    return trackedPanels.get(panel)?.data.value
  }

  function findPreviewPanel(webviewId: WebviewId): WebviewPanel | undefined {
    for (const [panel, trackedPanel] of trackedPanels) {
      if (
        trackedPanel.webviewId === webviewId &&
        trackedPanel.isPreview &&
        !isPanelDisposed(panel)
      ) {
        return panel
      }
    }

    return undefined
  }

  /**
   * Returns a snapshot of all live panels of the given kind, as input for
   * `resolvePanelReuse()`.
   */
  function getPanelReuseCandidates(webviewId: WebviewId): PanelReuseCandidate<WebviewPanel>[] {
    const candidates: PanelReuseCandidate<WebviewPanel>[] = []
    for (const [panel, trackedPanel] of trackedPanels) {
      if (trackedPanel.webviewId === webviewId && !isPanelDisposed(panel)) {
        candidates.push({
          panel,
          data: trackedPanel.data.value,
          isPreview: trackedPanel.isPreview,
        })
      }
    }

    return candidates
  }

  /**
   * Re-runs the state-pushing effect of every live panel currently rendering the given
   * data, syncing it with the latest state.
   */
  function refreshPanelsByData(webviewId: WebviewId, data: string): void {
    for (const [panel, trackedPanel] of trackedPanels) {
      if (
        trackedPanel.webviewId === webviewId &&
        trackedPanel.data.value === data &&
        !isPanelDisposed(panel)
      ) {
        trackedPanel.effectRunner()
      }
    }
  }

  return {
    track,
    untrack,
    retarget,
    getPanelData,
    getPanelReuseCandidates,
    refreshPanelsByData,
    isPanelDisposed,
  }
})

function isPanelDisposed(panel: WebviewPanel) {
  try {
    void panel.webview // getter will throw if panel is disposed

    return false
  } catch {
    return true
  }
}
