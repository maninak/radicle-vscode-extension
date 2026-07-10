/**
 * Returns the interpolated hover text for a revision.
 */
export function getRevisionHoverTitle(revisionDescription: string) {
  return `Click to See Revision Details\n⸻\nRevision Description:\n"${revisionDescription}"`
}

/**
 * Merges a state update pushed by the extension into the webview's current state.
 *
 * Keeps the webview's own extra state (e.g. in-progress form drafts) as long as the update
 * still concerns the same patch, but resets it to the given pristine value when the panel
 * got retargeted to render a different patch, so drafts never leak across patches. The
 * record of already-consumed injected-state ids survives either way, keeping stale
 * html-injected state rejected after a webview reload.
 */
export function getStateMergedWithUpdate<
  State extends { state: { patch: { id: string } }; injectedStateIds: number[] },
>(
  currentState: State,
  pristineExtraState: { injectedStateIds: number[] },
  update: { state: { patch: { id: string } } },
): State {
  const isNewPatch = update.state.patch.id !== currentState.state.patch.id
  const retainedState = isNewPatch
    ? { ...pristineExtraState, injectedStateIds: currentState.injectedStateIds }
    : { ...currentState }

  return { ...currentState, ...retainedState, ...update }
}
