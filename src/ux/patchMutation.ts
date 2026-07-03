import type { PatchMutatorResult } from '../helpers'
import type { Patch } from '../types'
import { commands, ProgressLocation, window } from 'vscode'
import { usePatchStore } from '../stores'
import { log, showLog, truncateKeepWords } from '../utils'
import { patchesViewId } from './patchesView'
import { launchAuthenticationFlow } from './radicleIdentityAuth'

export type PatchMutator = (
  timeoutSeconds?: number,
) => PatchMutatorResult | Promise<PatchMutatorResult>

/**
 * Handles the UX after applying the mutator provided to update a patch on Radicle.
 * Specifically it notifies the user of the outcome and, when fitting, offers
 * optional follow-up actions e.g. retrying with longer timeout.
 */
export async function mutatePatch(
  patchId: Patch['id'],
  patchTitle: string,
  patchMutator: PatchMutator,
  timeoutSeconds?: number,
) {
  let mutateOp: PatchMutatorResult
  const isAuthed = await launchAuthenticationFlow()
  if (isAuthed) {
    mutateOp = await window.withProgress(
      (timeoutSeconds ?? -1) < 30
        ? { location: { viewId: patchesViewId } }
        : {
            location: ProgressLocation.Window,
            title: `‎$(radicle-logo) Updating patch "${truncateKeepWords(
              patchTitle,
              60,
              `[…]`,
            )}"…`,
          },
      async () => await patchMutator(timeoutSeconds),
    )
  } else {
    mutateOp = { outcome: 'failure', errorMsg: "User isn't authorized to perform action" }
  }

  const buttonOutput = 'Show Output'

  if (mutateOp.outcome === 'failure') {
    const didTimeOut = mutateOp.errorMsg.replaceAll(' ', '').toLowerCase().includes('timedout')
    const buttonRetryHarder = 'Retry With Longer Timeout'
    const patchName = `"${truncateKeepWords(patchTitle, 41)}"` // magic number to fit in one line

    const userSelection = await window.showErrorMessage(
      `Failed updating patch ${patchName}`,
      ...[didTimeOut ? buttonRetryHarder : undefined, buttonOutput].filter(Boolean),
    )

    if (userSelection === buttonOutput) {
      showLog()
    } else if (userSelection === buttonRetryHarder) {
      await mutatePatch(patchId, patchTitle, patchMutator, (timeoutSeconds ?? 60) * 4)
    }

    return
  }

  usePatchStore().reloadPatch(patchId)

  if (mutateOp.outcome === 'success' && mutateOp.didAnnounce) {
    const patchName = `"${truncateKeepWords(patchTitle, 20)}"` // magic number to fit in one line
    window.showInformationMessage(`Updated and announced patch ${patchName} to the network`)

    return
  }

  if (mutateOp.outcome === 'success' && !mutateOp.didAnnounce) {
    const patchName = `"${truncateKeepWords(patchTitle, 60)}"`
    const buttonRetry = 'Retry Announce'

    const userSelection = await window.showWarningMessage(
      `Updated patch ${patchName} locally but failed announcing it to the network`,
      buttonRetry,
      buttonOutput,
    )

    if (userSelection === buttonOutput) {
      showLog()
    } else if (userSelection === buttonRetry) {
      commands.executeCommand('radicle.announce')
    }

    return
  }

  log(new Error(' ').stack || '', 'error', "Reached no man's land")
}
