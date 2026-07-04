import type { Patch, PatchDetailWebviewInjectedState } from '../types'
import {
  commands,
  ExtensionMode,
  Uri,
  ViewColumn,
  type Webview,
  type WebviewPanel,
  window,
} from 'vscode'
import { execPatchMutation, revealPatch } from '.'
import {
  allWebviewIds,
  useEnvStore,
  usePatchStore,
  useWebviewStore,
  type WebviewId,
} from '../stores'
import { assert, assertUnreachable, getNonce, truncateKeepWords } from '../utils'
import { type notifyExtension, notifyWebview } from '../utils/webview-messaging'
import {
  checkOutDefaultBranch,
  checkOutPatch,
  copyToClipboardAndNotify,
  mutatePatch,
} from '../ux'

// TODO: move this file (and other found in helpers) to "/services" or "/providers"

/**
 * Opens a panel with the specified webview in the active column.
 *
 * If the webview is already open and visible in another column it will be moved to the active
 * column without getting re-created.
 */
export async function createOrReuseWebviewPanel({
  webviewId,
  data,
  proposedPanelTitle,
}: /* unite here alternative `webviewId` & `data` pairs as new webviews get built */ {
  /**
   * The identifier specifying the kind of the panel to be (re-)used.
   */
  webviewId: 'webview-patch-detail'
  /**
   * The data to be used for the UI rendered on the webview.
   */
  data: Patch['id']
  /**
   * The proposed title to be used for the webview panel's tab. May be further processed.
   */
  proposedPanelTitle: string
}) {
  const column = window.activeTextEditor ? window.activeTextEditor.viewColumn : undefined
  const webviewStore = useWebviewStore()
  const foundPanel = webviewStore.find(`${webviewId}_${data}`)?.panel
  const stateForWebview = await getStateForWebview(webviewId, data)

  if (foundPanel && !webviewStore.isPanelDisposed(foundPanel)) {
    alignUiWithWebviewPatchDetailState(foundPanel, stateForWebview)
    foundPanel.reveal(column)

    return
  }

  createAndShowWebviewPanel(webviewId, proposedPanelTitle, stateForWebview, column)
}

/**
 * Restores the webview across restarts using the persisted state, if available.
 *
 * @see https://code.visualstudio.com/api/extension-guides/webview#serialization
 */
export function registerAllWebviewRestorators() {
  for (const webviewId of allWebviewIds) {
    switch (webviewId) {
      case 'webview-patch-detail':
        useEnvStore().extCtx.subscriptions.push(
          window.registerWebviewPanelSerializer(webviewId, {
            deserializeWebviewPanel: async (
              panel,
              state?: Awaited<ReturnType<typeof getStateForWebview>>,
            ) => {
              if (state) {
                initializePanel(panel, webviewId, state)
              } else {
                const patchStore = usePatchStore()
                patchStore.initStoreIfNeeded()
                const foundPatch = patchStore.findPatchByTitle(panel.title.replace(/…?$/, ''))

                if (!foundPatch) {
                  panel.dispose()

                  return
                }

                const recreatedState = await getStateForWebview(webviewId, foundPatch.id)
                initializePanel(panel, webviewId, recreatedState)
              }
            },
          }),
        )
        break
      default:
        assertUnreachable(webviewId)
    }
  }
}

export async function getStateForWebview(
  webviewId: 'webview-patch-detail',
  patchId: Patch['id'],
): Promise<PatchDetailWebviewInjectedState>

// getStateForWebview keeps its async/Promise contract (overloaded, awaited by callers) even
// though its only async step (reloadPatch) is now synchronous.
// eslint-disable-next-line  consistent-return, jsdoc/require-jsdoc, require-await
export async function getStateForWebview(
  webviewId: WebviewId,
  data: unknown,
): Promise<unknown> {
  switch (webviewId) {
    case 'webview-patch-detail': {
      const patchStore = usePatchStore()
      const patchId = data as Patch['id']
      let patch = patchStore.findPatchById(patchId)
      if (!patch) {
        patchStore.reloadPatch(patchId)
        patch = patchStore.findPatchById(patchId)
      }
      assert(patch)

      const isCheckedOut = patch.id === patchStore.checkedOutPatch?.id

      const { currentRepoInfo, localIdentity: localId } = useEnvStore()
      assert(currentRepoInfo)

      const state: PatchDetailWebviewInjectedState = {
        kind: webviewId,
        id: Date.now(),
        state: {
          // Spreading the patch definitely breaks original patch proxy's reactivity,
          // but not doing it seems to have no positive effect (as of writing this)
          // and may well also introduce regressions. A cleaner alternative could be
          // to have a new additional property `isPatchCheckedOut` but a quick try
          // with that introduced reactivity __regressions__ regarding patch checkout.
          // Alas, a fight for another day... Perhaps when the webview insta-disposing
          // issue is resolved? :thinking:
          patch: { ...patch, isCheckedOut },
          timeLocale: useEnvStore().timeLocaleBcp47,
          delegates: currentRepoInfo.delegates,
          defaultBranch: currentRepoInfo.defaultBranch,
          localIdentity: localId ? { id: localId.DID, alias: localId.alias } : undefined,
        },
      }

      return state
    }
    default:
      assertUnreachable(webviewId)
  }
}

function createAndShowWebviewPanel(
  webviewId: Parameters<typeof createOrReuseWebviewPanel>['0']['webviewId'],
  panelTitle: string,
  stateForWebview: Awaited<ReturnType<typeof getStateForWebview>>,
  column?: Parameters<typeof window.createWebviewPanel>['2'],
) {
  const panel = window.createWebviewPanel(
    webviewId,
    getFormatedPanelTitle(panelTitle),
    column ?? ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        Uri.joinPath(useEnvStore().extCtx.extensionUri, 'dist'),
        Uri.joinPath(useEnvStore().extCtx.extensionUri, 'assets'),
        Uri.joinPath(useEnvStore().extCtx.extensionUri, 'src', 'webviews', 'dist'),
      ],
      enableFindWidget: true,
    },
  )

  initializePanel(panel, webviewId, stateForWebview)
}

/**
 * Truncates a panel title to a display-friendly length.
 *
 * @param title - The full panel title string.
 * @returns The title truncated to 30 words with trailing words preserved.
 */
export function getFormatedPanelTitle(title: string) {
  const truncatedTitle = truncateKeepWords(title, 30)

  return truncatedTitle
}

function initializePanel(
  panel: WebviewPanel,
  webviewId: Parameters<typeof createOrReuseWebviewPanel>['0']['webviewId'],
  stateForWebview: Awaited<ReturnType<typeof getStateForWebview>>,
) {
  const patchId = stateForWebview.state.patch.id

  const webviewStore = useWebviewStore()
  webviewStore.track(panel, webviewId, patchId)

  panel.onDidDispose(
    () => webviewStore.untrack(`${webviewId}_${patchId}`),
    undefined,
    useEnvStore().extCtx.subscriptions,
  )

  panel.onDidChangeViewState(
    async (viewChangedPanel) => {
      if (viewChangedPanel.webviewPanel.visible) {
        const newStateForWebview = await getStateForWebview(webviewId, patchId)
        alignUiWithWebviewPatchDetailState(viewChangedPanel.webviewPanel, newStateForWebview)
      }
    },
    undefined,
    useEnvStore().extCtx.subscriptions,
  )

  let handleMessageFromWebview: Parameters<Webview['onDidReceiveMessage']>['0']
  switch (webviewId) {
    case 'webview-patch-detail':
      handleMessageFromWebview = (
        message: Parameters<typeof handleMessageFromWebviewPatchDetail>[0],
      ) => {
        handleMessageFromWebviewPatchDetail(message, panel.webview)
      }
      break
    default:
      assertUnreachable(webviewId)
  }
  panel.webview.onDidReceiveMessage(
    handleMessageFromWebview,
    undefined,
    useEnvStore().extCtx.subscriptions,
  )

  panel.webview.html = getWebviewHtml(panel.webview, stateForWebview)
}

/**
 * Syncs the VS Code webview panel UI to match the given patch detail state.
 *
 * Updates the webview's injected state, panel title, and icon to reflect the current patch.
 * No-ops if the panel has already been disposed.
 *
 * @param panel - The webview panel to update.
 * @param state - The patch detail state to push into the webview.
 */
export function alignUiWithWebviewPatchDetailState(
  panel: WebviewPanel,
  state: PatchDetailWebviewInjectedState,
) {
  if (!useWebviewStore().isPanelDisposed(panel)) {
    notifyWebview({ command: 'updateState', payload: state }, panel.webview)
    panel.title = getFormatedPanelTitle(state.state.patch.title)

    if (panel.viewType === 'webview-patch-detail') {
      panel.iconPath = Uri.joinPath(
        useEnvStore().extCtx.extensionUri,
        'assets',
        'patch-status-icons',
        `patch-${state.state.patch.state.status}.svg`,
      )
    }
  }
}

function handleMessageFromWebviewPatchDetail(
  message: Parameters<typeof notifyExtension>['0'],
  webview: Webview,
) {
  switch (message.command) {
    case 'showInfoNotification': {
      const button = 'Reset Count'
      window.showInformationMessage(message.payload.text, button).then((userSelection) => {
        userSelection === button &&
          notifyWebview({ command: 'resetCount', payload: undefined }, webview)
      })
      break
    }
    case 'copyToClipboardAndNotify':
      copyToClipboardAndNotify(message.payload.textToCopy)
      break
    case 'refreshPatchData':
      commands.executeCommand('radicle.refreshOnePatch', message.payload.patchId)
      break
    case 'checkOutPatchBranch':
      checkOutPatch(message.payload.patch)
      break
    case 'checkOutDefaultBranch':
      checkOutDefaultBranch()
      break
    case 'revealInPatchesView':
      revealPatch(message.payload.patch, { expand: true, focus: true })
      break
    case 'openPatchMultiFileDiff':
      commands.executeCommand('radicle.openAllPatchFileChanges', message.payload.patch)
      break
    case 'updatePatchTitleAndDescription':
      mutatePatch(message.payload.patchId, message.payload.oldTitle, (timeout?: number) =>
        execPatchMutation(
          [
            'edit',
            message.payload.patchId,
            '--message',
            message.payload.newTitle,
            '--message',
            message.payload.newDescr,
          ],
          timeout,
        ),
      )
      break
    case 'updatePatchStatus':
      {
        const patch = message.payload.patch
        const newStatus = message.payload.newStatus

        if (newStatus === patch.state.status) {
          break
        }

        switch (newStatus) {
          case 'draft':
            commands.executeCommand('radicle.draftizePatch', patch)
            break
          case 'open':
            commands.executeCommand('radicle.openPatch', patch)
            break
          case 'archived':
            commands.executeCommand('radicle.archivePatch', patch)
            break
          default:
            assertUnreachable(newStatus)
        }
      }
      break
    case 'createPatchComment':
      mutatePatch(message.payload.patch.id, message.payload.patch.title, (timeout?: number) =>
        execPatchMutation(
          ['comment', message.payload.revisionId, '--message', message.payload.comment],
          timeout,
        ),
      )
      break
    default:
      assertUnreachable(message)
  }
}

/**
 * Origin of the Vite dev server used for webview HMR during local development.
 * Must match `server.port` and `server.origin` in `vite.config.ts`.
 */
const WEBVIEW_DEV_SERVER_ORIGIN = 'http://localhost:5173'

function getWebviewHtml<State extends object>(webview: Webview, state?: State) {
  const isDevMode = useEnvStore().extCtx.extensionMode === ExtensionMode.Development
  const allowedSource = webview.cspSource
  const nonce = getNonce()

  const devServer = WEBVIEW_DEV_SERVER_ORIGIN

  const cspConnectSrc = isDevMode ? `${devServer} ws://localhost:5173` : `'none'`
  const cspStyleSrc = isDevMode
    ? `${allowedSource} ${devServer} 'unsafe-inline'`
    : `${allowedSource} 'unsafe-inline'`
  const cspFontSrc = isDevMode ? `${allowedSource} ${devServer}` : allowedSource

  const headTags = isDevMode
    ? `<script type="module" src="${devServer}/@vite/client" nonce="${nonce}"></script>`
    : `<link rel="stylesheet" type="text/css" href="${getWebviewUri(webview, ['src', 'webviews', 'dist', 'assets', 'index.css']).toString()}" nonce="${nonce}">`
  const scriptSrc = isDevMode
    ? `${devServer}/src/main.ts`
    : getWebviewUri(webview, ['src', 'webviews', 'dist', 'assets', 'index.js']).toString()

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta
        http-equiv="Content-Security-Policy"
        content="
          default-src 'none';
          object-src 'none';
          base-uri 'none';
          connect-src ${cspConnectSrc};
          style-src ${cspStyleSrc};
          img-src ${allowedSource} https: data:;
          script-src 'strict-dynamic' 'nonce-${nonce}' 'unsafe-inline' https:;
          font-src ${cspFontSrc};
        "
      >
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      ${headTags}
      <script nonce="${nonce}">
        window.injectedWebviewState = ${JSON.stringify(state)}
      </script>
    </head>
    <body>
      <div id="app"></div>
      <script type="module" src="${scriptSrc}" nonce="${nonce}"></script>
    </body>
    </html>
  `

  return html
}

function getWebviewUri(webview: Webview, pathList: string[]): Uri {
  return webview.asWebviewUri(Uri.joinPath(useEnvStore().extCtx.extensionUri, ...pathList))
}
