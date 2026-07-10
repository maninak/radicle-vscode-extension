/*
 * Pure decision logic for opening a webview panel with preview-like semantics: normal
 * opens funnel into a single designated reusable "preview" panel, while explicit
 * open-to-the-side panels stay standalone, like kept editor tabs. No vscode imports so
 * it stays trivially unit-testable.
 */

/**
 * A live (non-disposed) webview panel considered for reuse.
 */
export interface PanelReuseCandidate<P> {
  /**
   * Opaque handle to the panel, returned as-is in the decision.
   */
  panel: P
  /**
   * Identifier of the data (e.g. a patch id) the panel currently renders.
   */
  data: string
  /**
   * Whether the panel is the designated reusable "preview" panel of its webview kind.
   */
  isPreview: boolean
}

export type PanelReuseDecision<P> =
  | { verb: 'reveal'; panel: P }
  | { verb: 'retarget'; panel: P }
  | { verb: 'create'; asPreview: boolean }

/**
 * Decides which panel should host the given data and how.
 *
 * With intent `'reusePreview'` (a normal open): an existing panel already rendering the
 * data gets revealed (a standalone one preferred over the preview panel, matching how
 * VS Code focuses an already open kept tab); otherwise the preview panel, if alive, gets
 * retargeted to render the data in place; otherwise a new preview panel gets created.
 *
 * With intent `'standalone'` (an explicit open to the side): an existing standalone panel
 * already rendering the data gets revealed, otherwise a new standalone one gets created,
 * never touching the preview panel.
 *
 * The given candidates must be live panels of the same webview kind; disposed panels must
 * be filtered out by the caller.
 */
export function resolvePanelReuse<P>({
  intent,
  data,
  candidates,
}: {
  intent: 'reusePreview' | 'standalone'
  data: string
  candidates: PanelReuseCandidate<P>[]
}): PanelReuseDecision<P> {
  const standaloneRenderingData = candidates.find(
    (candidate) => !candidate.isPreview && candidate.data === data,
  )
  if (standaloneRenderingData) {
    return { verb: 'reveal', panel: standaloneRenderingData.panel }
  }

  if (intent === 'standalone') {
    return { verb: 'create', asPreview: false }
  }

  const previewPanel = candidates.find((candidate) => candidate.isPreview)
  if (previewPanel) {
    return previewPanel.data === data
      ? { verb: 'reveal', panel: previewPanel.panel }
      : { verb: 'retarget', panel: previewPanel.panel }
  }

  return { verb: 'create', asPreview: true }
}
