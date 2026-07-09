import type { Webview } from 'vscode'
import type {
  AugmentedPatch,
  Patch,
  PatchDetailWebviewInjectedState,
  PatchStatus,
  Revision,
} from '../types'
import { getVscodeRef } from '../webviews/src/utils/getVscodeRef'

interface Message<Command extends string, Payload extends object | undefined = undefined> {
  command: Command
  payload: Payload
}

type MessageToWebview =
  | Message<'updateState', PatchDetailWebviewInjectedState>
  | Message<'resetCount'>

type MessageToExtension =
  | Message<'showInfoNotification', { text: string }>
  | Message<'copyToClipboardAndNotify', { textToCopy: string }>
  | Message<'refreshPatchData', { patchId: Patch['id'] }>
  | Message<'checkOutPatchBranch', { patch: Patch }>
  | Message<'revealInPatchesView', { patch: AugmentedPatch }>
  | Message<'openPatchMultiFileDiff', { patch: AugmentedPatch }>
  | Message<'openRevisionDiff', { patch: AugmentedPatch; revisionId: string }>
  | Message<'checkOutDefaultBranch'>
  | Message<
      'updatePatchTitleAndDescription',
      { patchId: Patch['id']; newTitle: string; newDescr: string; oldTitle: string }
    >
  | Message<'updatePatchStatus', { patch: Patch; newStatus: Exclude<PatchStatus, 'merged'> }>
  | Message<
      'createPatchComment',
      { patch: Patch; revisionId: Revision['id']; comment: string }
    >

/**
 * Sends a message, usually from the host window, to the provided webview.
 *
 * Note: only supports whatever Window.structuredClone() supports. This means that Proxys
 * and specifically Vue objects like `Ref` and `Reactive` that use them are not supported.
 * Make sure to wrap them with Vue.toRaw() before passing them as a payload.
 */
export function notifyWebview(message: MessageToWebview, webview: Webview): void {
  webview.postMessage(message)
}

/**
 * Sends a message from within a webview to the VS Code extension hosting it.
 *
 * Note: only supports whatever Window.structuredClone() supports. This means that Proxys
 * and specifically Vue objects like `Ref` and `Reactive` that use them are not supported.
 * Make sure to wrap them with Vue.toRaw() before passing them as a payload.
 */
export function notifyExtension(message: MessageToExtension): void {
  getVscodeRef().postMessage(message)
}
