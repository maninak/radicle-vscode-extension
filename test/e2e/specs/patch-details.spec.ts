import type * as VsCode from 'vscode'
import type { WebView, Workbench } from 'wdio-vscode-service'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import { $, browser, expect } from '@wdio/globals'
import { Key } from 'webdriverio'
import { cd, $ as zx } from 'zx'
import { httpdHost } from '../constants'
import { openRadicleViewContainer } from '../helpers/actions'
import {
  expectNotificationToContain,
  expectStandardSidebarViewsToBeVisible,
} from '../helpers/assertions'
import { getWorkerHttpdPort } from '../helpers/paths'
import {
  assertExtensionResolvedTestSandbox,
  startWorkerNode,
  stopWorkerNodeAndHttpd,
} from '../helpers/testSandbox'

const selectors = {
  openPatchDetailsButton: 'aria/Open Patch Details',
  changePatchStatusButton: '[title="Change Patch Status"]',
  draftRadioButton: 'aria/Draft',
  stopEditingPatchStatusButton: '[title="Stop Editing Patch Status"]',
  refreshPatchDataButton: '[title="Refresh Patch Data"]',
  editPatchTitleButton: '[title="Edit Patch Title and Description"]',
  patchTitleInput: 'aria/Patch Title:',
  patchDescriptionInput: 'aria/Patch Description:',
  savePatchEditsButton: '[title="Save Changes to Radicle (Ctrl + Enter)"]',
  openPatchIcon: '.codicon-git-pull-request',
  draftPatchIcon: '.codicon-git-pull-request-draft',
  checkOutPatchBranchButton: '[title^="Check Out the Git Branch"]',
  checkOutDefaultBranchButton: '[title^="Switch from the Git Branch"]',
  checkOutPatchInlineButton: 'aria/Check Out Patch Branch',
} as const

const initialPatchTitle = 'feat: add hello world greeting'
const initialPatchDescription = 'Adds a friendly greeting file'
const cliEditedPatchTitle = 'feat: add hello world greeting v2'
const cliEditedPatchDescription = 'Adds an even friendlier greeting file'
const webviewEditedPatchTitle = 'feat: hello galaxy'
const webviewEditedPatchDescription = 'Greets the whole galaxy now'

// This spec deliberately starts NO radicle-httpd: the patch features under test must work
// with the local Radicle node alone, sourced via the `rad` CLI and git.
describe("Patch details, of a patch on the user's own rad-initialized repo,", () => {
  let workbench: Workbench
  let workerIndex: number
  let workspacePath: string
  let patchId: string

  before(async () => {
    await assertExtensionResolvedTestSandbox()
    workbench = await browser.getWorkbench()
    workerIndex = Number(process.env['RAD_E2E_WORKER_INDEX'] ?? '0')
    workspacePath = process.env['RAD_E2E_WORKSPACE'] ?? ''

    await startWorkerNode(workerIndex)
    await initRadRepoWithPatch(workspacePath)
    patchId = getSeededPatchId(workspacePath)

    await openRadicleViewContainer(workbench)
    await expectStandardSidebarViewsToBeVisible(workbench)
  })

  after(() => {
    stopWorkerNodeAndHttpd(workerIndex)
  })

  afterEach(async () => {
    await switchBackToMainFrame()
  })

  it('needs no Radicle HTTP API: nothing listens on the configured endpoint', async () => {
    const isEndpointPortInUse = await new Promise<boolean>((resolve) => {
      const socket = net
        .connect({ host: httpdHost, port: getWorkerHttpdPort(workerIndex) })
        .once('connect', () => {
          socket.destroy()
          resolve(true)
        })
        .once('error', () => {
          socket.destroy()
          resolve(false)
        })
    })

    expect(isEndpointPortInUse).toBe(false)
  })

  it('lists the patch in the Patches sidebar view, sourced from the local node', async () => {
    const patchItem = await findPatchItem(initialPatchTitle)

    await expect(patchItem).toBeDisplayed()
    await expect(patchItem.$(selectors.openPatchIcon)).toBeDisplayed()
  })

  it("opens a webview rendering the patch's data", async () => {
    await openPatchDetails(initialPatchTitle)

    const webview = await switchToPatchDetailWebview(workbench)

    await expect($(`p=${initialPatchTitle}`)).toBeDisplayed()
    await expect($(`p=${initialPatchDescription}`)).toBeDisplayed()
    await expect($(`header ${selectors.openPatchIcon}`)).toBeDisplayed()
    // the author renders its alias (`test_user`), resolved from the local node's address book,
    // rather than a shortened node id — the end-to-end assertion for alias resolution
    await expect($('pre*=test_user')).toBeDisplayed()

    await webview.close()
  })

  it('updates the webview and the sidebar when the patch changes outside them', async () => {
    await zx`rad patch edit ${patchId} --message ${cliEditedPatchTitle} --message ${cliEditedPatchDescription}`

    const webview = await switchToPatchDetailWebview(workbench)
    // Round trip: webview --> extension `refreshPatchData` message, patchStore refetch from
    // the node, extension --> webview `updateState` message, reactive re-render.
    await $(selectors.refreshPatchDataButton).click()

    await expect($(`p=${cliEditedPatchTitle}`)).toBeDisplayed()
    await expect($(`p=${cliEditedPatchDescription}`)).toBeDisplayed()

    await webview.close()

    // The same refetch must also reactively re-render the patch's item in the sidebar.
    const patchItem = await findPatchItem(cliEditedPatchTitle)

    await expect(patchItem).toBeDisplayed()
  })

  it('persists a patch status change submitted from within the webview', async () => {
    const webview = await switchToPatchDetailWebview(workbench)

    await $(selectors.changePatchStatusButton).moveTo()
    await $(selectors.changePatchStatusButton).click()
    await $(selectors.draftRadioButton).click()
    await $(selectors.stopEditingPatchStatusButton).click()

    // move the pointer off the status badge: while hovered it CSS-hides the status icon
    await $(selectors.refreshPatchDataButton).moveTo()

    await browser.waitUntil(
      async () => await $(`header ${selectors.draftPatchIcon}`).isDisplayed(),
      { timeoutMsg: 'expected the webview header to show the draft status icon' },
    )

    await webview.close()

    await browser.waitUntil(
      async () => {
        const patchItem = await findPatchItem(cliEditedPatchTitle)

        return await patchItem.$(selectors.draftPatchIcon).isExisting()
      },
      { timeoutMsg: 'expected the sidebar patch item to get the draft status icon' },
    )

    expect(getPatchStatusFromRadCli(workspacePath, patchId)).toBe('draft')
  })

  it('persists patch title and description edits submitted from within the webview', async () => {
    const webview = await switchToPatchDetailWebview(workbench)

    await $(`p=${cliEditedPatchTitle}`).moveTo()
    await $(selectors.editPatchTitleButton).click()
    await findAndFillInput(selectors.patchTitleInput, webviewEditedPatchTitle)
    await findAndFillInput(selectors.patchDescriptionInput, webviewEditedPatchDescription)
    await $(selectors.savePatchEditsButton).click()

    await expect($(`p=${webviewEditedPatchTitle}`)).toBeDisplayed()
    await expect($(`p=${webviewEditedPatchDescription}`)).toBeDisplayed()

    await webview.close()

    const patchItem = await findPatchItem(webviewEditedPatchTitle)

    await expect(patchItem).toBeDisplayed()

    // the webview panel's tab title must reactively follow the patch title
    await expect($(`.tab[aria-label*="${webviewEditedPatchTitle}"]`)).toBeDisplayed()

    const patchShowOutput = (await zx`rad patch show ${patchId}`).stdout

    expect(patchShowOutput).toContain(webviewEditedPatchTitle)
  })

  it("lists a patch's changed files, diffed via git, and opens a diff editor", async () => {
    const patchItem = await findPatchItem(webviewEditedPatchTitle)
    await patchItem.click()

    const filechangeItem = await findPatchItem('hello.txt')

    await expect(filechangeItem).toBeDisplayed()

    await filechangeItem.click()

    // a diff editor tab labeled "hello.txt (<oldSha> ⟷ <newSha>) Added" must open
    await expect($(`.tab[aria-label*="hello.txt ("]`)).toBeDisplayed()

    // close the diff editor, revealing the webview again: a backgrounded webview tab has
    // no live iframe, which would break all following webview interactions
    await browser.executeWorkbench(async (vscode: typeof VsCode) => {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
      // also collapse the expanded patch item again to not affect follow-up tests
      await vscode.commands.executeCommand(
        'workbench.actions.treeView.patches-view.collapseAll',
      )
    })
  })
})

/**
 * Git- and rad-initializes the opened workspace with this worker's own identity, then creates
 * a patch on it via a real `git push rad HEAD:refs/patches`.
 */
async function initRadRepoWithPatch(workspacePath: string) {
  cd(workspacePath)
  await zx`git init -b master .`
  await zx`git config --local user.email "test@radicle.dev"`
  await zx`git config --local user.name "Radicle Test"`
  await zx`echo "# Patch Details Repo" > README.md`
  await zx`git add README.md`
  await zx`git commit -m 'adds readme' --no-gpg-sign`
  await radInitPublicRepo(workspacePath)
  await zx`git checkout -b feat/hello-world`
  await zx`echo 'Hello, World!' > hello.txt`
  await zx`git add hello.txt`
  await zx`git commit -m ${initialPatchTitle} -m ${initialPatchDescription} --no-gpg-sign`
  await zx`git push rad HEAD:refs/patches`
}

/**
 * Rad-initializes the workspace as a public repo. Against a just-started node, `rad init`'s
 * seeding step can transiently fail with a sqlite error (e.g. "database is locked") after
 * the repo identity was already created; in that case finish the seeding with `rad seed`,
 * retrying until the node lets it through.
 */
async function radInitPublicRepo(workspacePath: string) {
  try {
    await zx`rad init --public --default-branch master --name e2e-patch-details --description ${'A repo seeded for the e2e patch details test'} --no-confirm`
  } catch (initError) {
    let rid: string
    try {
      rid = execFileSync('rad', ['inspect', '--rid'], {
        cwd: workspacePath,
        encoding: 'utf-8',
      }).trim()
    } catch {
      throw initError
    }

    await browser.waitUntil(
      async () => {
        try {
          await zx`rad seed ${rid}`

          return true
        } catch {
          return false
        }
      },
      { timeoutMsg: `expected \`rad seed ${rid}\` to recover the failed \`rad init\`` },
    )
  }
}

/**
 * Resolves the id of the just-created patch from the worker's own node via the `rad` CLI.
 */
function getSeededPatchId(workspacePath: string) {
  const rid = execFileSync('rad', ['inspect', '--rid'], {
    cwd: workspacePath,
    encoding: 'utf-8',
  }).trim()
  const patchIds = execFileSync(
    'rad',
    ['cob', 'list', '--repo', rid, '--type', 'xyz.radicle.patch'],
    { encoding: 'utf-8' },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)

  const patchId = patchIds[0]
  if (patchIds.length !== 1 || !patchId) {
    throw new Error(
      `Expected the node to hold exactly the one seeded patch, but got: ${String(patchIds)}`,
    )
  }

  return patchId
}

function getPatchStatusFromRadCli(workspacePath: string, patchId: string) {
  // `rad patch show` labels the patch's status as e.g. "Status    draft" in its header.
  const output = execFileSync('rad', ['patch', 'show', patchId], {
    cwd: workspacePath,
    encoding: 'utf-8',
  })
  const status = output.match(/Status\s+(\w+)/)?.[1]

  return status
}

/**
 * Finds the tree row of the patch labeled `label` in the Patches sidebar view.
 *
 * HACK(wdio): queries the DOM directly because wdio-vscode-service@6.1.4 resolves its
 * locators with a lexical version comparison, handing VS Code >= 1.100 the outdated 1.37
 * locators and thus breaking its tree-related page objects (e.g. `ViewSection.findItem`
 * fails on `.panel-header`). Remove when the service compares versions numerically.
 */
function getPatchItemXpath(label: string) {
  // tree rows cloned into VS Code's sticky-scroll container are excluded: they linger
  // hidden after an expanded row scrolls or collapses, shadowing the real row
  return (
    `//div[contains(@class, "sidebar")]//div[contains(@class, "monaco-list-row")]` +
    `[not(ancestor::div[contains(@class, "monaco-tree-sticky-container")])]` +
    `[.//span[contains(text(), "${label}")]]`
  )
}

async function findPatchItem(label: string) {
  let patchItem: WebdriverIO.Element | undefined
  await browser.waitUntil(
    async () => {
      for (const row of await browser.$$(getPatchItemXpath(label))) {
        if (await row.isDisplayed()) {
          patchItem = row

          return true
        }
      }

      return false
    },
    { timeoutMsg: `expected to find a patch item labeled "${label}" in the Patches view` },
  )

  return patchItem!
}

/**
 * Returns the browser context to the top-level (main VS Code) frame. Needed in `afterEach`
 * because a failing assertion inside a webview's iframe would otherwise leave the context
 * switched into it, cascading bogus failures through all subsequent tests.
 */
async function switchBackToMainFrame() {
  await browser.switchToFrame(null)
}

/**
 * Opens (or reveals) the details webview of the patch item labeled `label`.
 *
 * An already open (but possibly backgrounded, and thus iframe-less) panel is revealed by
 * activating its editor tab. Otherwise the sidebar item's hover-only inline button is used,
 * retrying, since a re-render of the sidebar between hovering and clicking drops the
 * hover-only inline button mid-interaction.
 */
async function openPatchDetails(label: string) {
  const existingPanelTab = browser.$(`.tab[aria-label*="${label}"]`)
  if (await existingPanelTab.isExisting()) {
    await existingPanelTab.click()

    return
  }

  await clickPatchItemInlineButton(label, selectors.openPatchDetailsButton)
}

/**
 * Hovers the patch item labeled `label` and clicks the given hover-only inline button.
 * Retries, since a re-render of the sidebar between hovering and clicking drops the button
 * mid-interaction.
 */
async function clickPatchItemInlineButton(label: string, buttonSelector: string) {
  await browser.waitUntil(
    async () => {
      try {
        // park the pointer on neutral ground first: if it already rests where the row got
        // re-rendered, a stationary `moveTo` fires no fresh mouseenter and the hover-only
        // button never shows
        await $('.statusbar').moveTo()

        const patchItem = await findPatchItem(label)
        await patchItem.moveTo()
        const button = await patchItem.$(buttonSelector)

        try {
          await button.click()
        } catch {
          // hover-only inline actions can lose their hover mid-interaction when the row
          // re-renders; dispatching the click directly is deterministic
          await browser.execute((buttonElem) => (buttonElem as HTMLElement).click(), button)
        }

        return true
      } catch {
        return false
      }
    },
    {
      timeoutMsg: `expected to click "${buttonSelector}" on the item labeled "${label}"`,
    },
  )

  // park the pointer again: a lingering hover (and its tooltip) over the list makes
  // VS Code defer re-rendering the hovered rows, stalling the very updates we assert next
  await $('.statusbar').moveTo()
}

async function switchToPatchDetailWebview(workbench: Workbench) {
  let webviews: WebView[] = []
  await browser.waitUntil(
    async () => {
      webviews = await workbench.getAllWebviews()

      return webviews.length > 0
    },
    { timeoutMsg: 'expected an open webview' },
  )

  const webview = webviews[0]
  if (!webview) {
    throw new Error('expected an open webview')
  }
  await webview.open()

  return webview
}

describe('Patch state synchronization,', () => {
  const secondPatchTitle = 'feat: second patch'
  const thirdPatchTitle = 'feat: third patch'
  let workbench: Workbench
  let workspacePath: string
  let patchId: string
  let secondPatchId: string

  before(async () => {
    workbench = await browser.getWorkbench()
    workspacePath = process.env['RAD_E2E_WORKSPACE'] ?? ''
    patchId = getSeededPatchId(workspacePath)
  })

  afterEach(async () => {
    await switchBackToMainFrame()
  })

  it('reflects in the list and webview a patch checkout made from the terminal', async () => {
    await zx`rad patch checkout ${patchId} --force`

    await expectPatchItemCheckedOutMarker(webviewEditedPatchTitle, true)

    await openPatchDetails(webviewEditedPatchTitle)
    const webview = await switchToPatchDetailWebview(workbench)

    await expect($(selectors.checkOutDefaultBranchButton)).toBeDisplayed()

    await webview.close()
  })

  it('checks out the actual default git branch from within the webview', async () => {
    await openPatchDetails(webviewEditedPatchTitle)
    const webview = await switchToPatchDetailWebview(workbench)
    await $(selectors.checkOutDefaultBranchButton).click()

    await browser.waitUntil(() => getCurrentGitBranch(workspacePath) === 'master', {
      timeoutMsg: 'expected the default branch to get checked out',
    })

    await expect($(selectors.checkOutPatchBranchButton)).toBeDisplayed()

    await webview.close()

    await expectPatchItemCheckedOutMarker(webviewEditedPatchTitle, false)
  })

  it('checks out the patch despite a dirty working directory', async () => {
    await zx`echo "dirty but non-conflicting" >> README.md`

    await openPatchDetails(webviewEditedPatchTitle)
    const webview = await switchToPatchDetailWebview(workbench)
    await $(selectors.checkOutPatchBranchButton).click()

    await browser.waitUntil(() => getCurrentGitBranch(workspacePath).startsWith('patch/'), {
      timeoutMsg: 'expected the patch branch to get checked out',
    })

    await webview.close()

    await expectPatchItemCheckedOutMarker(webviewEditedPatchTitle, true)

    // NOTE: the extension runs `rad patch checkout --force`, which (like
    // `git checkout --force`) discards uncommitted changes to tracked files. This assertion
    // documents that behavior; if it ever becomes non-forced, update this test.
    expect(
      execFileSync('git', ['status', '--porcelain', 'README.md'], {
        cwd: workspacePath,
        encoding: 'utf-8',
      }).trim(),
    ).toBe('')
  })

  it('surfaces an error when a dirty working directory conflicts with a checkout', async () => {
    // a dirty tracked file that only exists on the patch branch makes git refuse to check
    // out the default branch, since that would discard the uncommitted changes
    await zx`echo "conflicting change" >> hello.txt`

    await openPatchDetails(webviewEditedPatchTitle)
    const webview = await switchToPatchDetailWebview(workbench)
    await $(selectors.checkOutDefaultBranchButton).click()
    await webview.close()

    await expectNotificationToContain(workbench, 'Failed checking out branch "master"')

    expect(getCurrentGitBranch(workspacePath).startsWith('patch/')).toBe(true)

    await zx`git checkout -- hello.txt`

    // dismiss the asserted error notification so it cannot obscure later interactions
    await browser.executeWorkbench(async (vscode: typeof VsCode) => {
      await vscode.commands.executeCommand('notifications.clearAll')
    })
  })

  it('moves the checked-out marker when checking out another patch', async () => {
    secondPatchId = await seedExtraPatch(workspacePath, 'feat/second', secondPatchTitle)
    await workbench.executeCommand('Refresh All Patch Data')

    await expect(await findPatchItem(secondPatchTitle)).toBeDisplayed()

    await zx`rad patch checkout ${patchId} --force`

    await expectPatchItemCheckedOutMarker(webviewEditedPatchTitle, true)

    await clickPatchItemInlineButton(secondPatchTitle, selectors.checkOutPatchInlineButton)

    await expectPatchItemCheckedOutMarker(secondPatchTitle, true)
    await expectPatchItemCheckedOutMarker(webviewEditedPatchTitle, false)

    expect(getCurrentGitBranch(workspacePath).startsWith('patch/')).toBe(true)

    // the first patch's webview must also reflect that it is not checked out anymore
    await openPatchDetails(webviewEditedPatchTitle)
    const webview = await switchToPatchDetailWebview(workbench)

    await expect($(selectors.checkOutPatchBranchButton)).toBeDisplayed()

    await webview.close()
  })

  it('sorts an out-of-band updated patch to the top, listing it exactly once', async () => {
    await seedExtraPatch(workspacePath, 'feat/third', thirdPatchTitle)
    await workbench.executeCommand('Refresh All Patch Data')

    await expect(await findPatchItem(thirdPatchTitle)).toBeDisplayed()
    await expectPatchItemToBeListedAbove(thirdPatchTitle, secondPatchTitle)

    // grow the older patch (the second) with a new revision, out of band
    await zx`git checkout feat/second`
    await zx`echo "more" >> second.txt`
    await zx`git add second.txt`
    await zx`git commit -m 'grows the second patch' --no-gpg-sign`
    await zx`git push rad HEAD:patches/${secondPatchId}`

    await workbench.executeCommand('Refresh All Patch Data')

    await expectPatchItemToBeListedAbove(secondPatchTitle, thirdPatchTitle)

    const rowsWithSecondPatchTitle = (await snapshotSidebarRowTexts()).filter((text) =>
      text.includes(secondPatchTitle),
    )

    expect(rowsWithSecondPatchTitle.length).toBe(1)
  })
})

/** Creates one more patch off of master, on `branchName`, and returns its id. */
async function seedExtraPatch(workspacePath: string, branchName: string, title: string) {
  const preexistingPatchIds = listPatchIds(workspacePath)

  cd(workspacePath)
  await zx`git checkout -b ${branchName} master`
  await zx`echo "content of ${branchName}" > ${`${branchName.split('/').at(-1)}.txt`}`
  await zx`git add .`
  await zx`git commit -m ${title} --no-gpg-sign`
  await zx`git push rad HEAD:refs/patches`

  const newPatchId = listPatchIds(workspacePath).find(
    (id) => !preexistingPatchIds.includes(id),
  )
  if (!newPatchId) {
    throw new Error(`Failed resolving the id of the just-seeded patch "${title}"`)
  }

  return newPatchId
}

function listPatchIds(workspacePath: string) {
  const rid = execFileSync('rad', ['inspect', '--rid'], {
    cwd: workspacePath,
    encoding: 'utf-8',
  }).trim()

  return execFileSync('rad', ['cob', 'list', '--repo', rid, '--type', 'xyz.radicle.patch'], {
    encoding: 'utf-8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
}

/**
 * Atomically snapshots the visible sidebar tree rows as text, sorted by their on-screen
 * vertical position. A single in-page evaluation sidesteps both element staleness during
 * re-renders and the fact that a virtualized monaco-list's DOM order does not reflect its
 * visual order.
 */
async function snapshotSidebarRowTexts(): Promise<string[]> {
  const rowTexts = await browser.execute(() => {
    const rows = Array.from(document.querySelectorAll('.sidebar .monaco-list-row'))

    return rows
      .filter(
        (row) =>
          row.closest('.monaco-tree-sticky-container') === null && row.offsetParent !== null,
      )
      .map((row) => ({ text: row.textContent ?? '', top: row.getBoundingClientRect().top }))
      .sort((row1, row2) => row1.top - row2.top)
      .map((row) => row.text)
  })

  return rowTexts
}

async function expectPatchItemToBeListedAbove(labelAbove: string, labelBelow: string) {
  let lastSnapshot: string[] = []
  await browser.waitUntil(
    async () => {
      lastSnapshot = await snapshotSidebarRowTexts()
      const indexAbove = lastSnapshot.findIndex((text) => text.includes(labelAbove))
      const indexBelow = lastSnapshot.findIndex((text) => text.includes(labelBelow))

      return indexAbove !== -1 && indexBelow !== -1 && indexAbove < indexBelow
    },
    {
      timeout: 20_000,
      timeoutMsg:
        `expected the item labeled "${labelAbove}" to be listed above "${labelBelow}". ` +
        `Rows: ${JSON.stringify(lastSnapshot)}`,
    },
  )
}

function getCurrentGitBranch(workspacePath: string) {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: workspacePath,
    encoding: 'utf-8',
  }).trim()
}

/** The marker `patchesView.ts` prefixes onto the label of the checked-out patch's item. */
const checkedOutMarker = '❬✓❭'

async function expectPatchItemCheckedOutMarker(label: string, isShown: boolean) {
  let lastRowText = '<no visible row found>'
  await browser.waitUntil(
    async () => {
      for (const row of await browser.$$(getPatchItemXpath(label))) {
        // rows may go stale mid-read while the list re-renders; skip and re-poll
        try {
          if (!(await row.isDisplayed())) {
            continue
          }
          lastRowText = await row.getText()

          return lastRowText.includes(checkedOutMarker) === isShown
        } catch {
          continue
        }
      }

      return false
    },
    {
      // patch checkouts trigger several successive re-renders, each involving a `rad cob show`
      // that can transiently fail and retry if it races the checkout's own node lock; under
      // heavy parallel CI load that chain occasionally needs more than a few seconds to settle
      timeout: 30_000,
      timeoutMsg: `expected the item labeled "${label}" to ${
        isShown ? 'show' : 'not show'
      } the checked-out marker. Last visible row text: "${lastRowText}"`,
    },
  )
}

async function findAndFillInput(selector: string, value: string) {
  const selectAllModifier = process.platform === 'darwin' ? Key.Command : Key.Ctrl
  await $(selector).click()
  await browser.keys([selectAllModifier, 'a'])
  await browser.keys(Key.Backspace)
  await browser.keys(value.split(''))
}
