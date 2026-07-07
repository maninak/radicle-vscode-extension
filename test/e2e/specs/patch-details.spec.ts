import type * as VsCode from 'vscode'
import type { WebView, Workbench } from 'wdio-vscode-service'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import net from 'node:net'
import { join } from 'node:path'
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
  archivedPatchIcon: '.codicon-git-pull-request-closed',
  checkOutPatchBranchButton: '[title^="Check Out the Git Branch"]',
  checkOutDefaultBranchButton: '[title^="Switch from the Git Branch"]',
  revealPatchButton: '[title^="Reveal Patch"]',
  checkOutPatchInlineButton: 'aria/Check Out Patch Branch',
} as const

const initialPatchTitle = 'feat: add hello world greeting'
const initialPatchDescription = 'Adds a friendly greeting file'
const cliEditedPatchTitle = 'feat: add hello world greeting v2'
const cliEditedPatchDescription = 'Adds an even friendlier greeting file'
const webviewEditedPatchTitle = 'feat: hello galaxy'
const webviewEditedPatchDescription = 'Greets the whole galaxy now'

// Bytes with a NUL and invalid-UTF-8 sequences (0xff 0xfe), so a string round-trip would
// corrupt them: proves the diff provider serves raw bytes, not a decoded string.
const binaryFileBytes = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]

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

    // the mutation's "Updated and announced patch" toast would otherwise linger into (and
    // intercept a click meant for a webview button in) the next test
    await dismissAllNotifications()
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

    await dismissAllNotifications()
  })

  it("lists a patch's changed files, diffed via git, and opens a diff editor", async () => {
    const patchItem = await findPatchItem(webviewEditedPatchTitle)
    await patchItem.click()

    const filechangeItem = await findPatchItem('hello.txt')

    await expect(filechangeItem).toBeDisplayed()

    await filechangeItem.click()

    // a diff editor tab labeled "hello.txt (<oldSha> ⟷ <newSha>) Added" must open
    await expect($(`.tab[aria-label*="hello.txt ("]`)).toBeDisplayed()

    // the diff's two sides must be served by the extension's virtual filesystem (no temp files
    // on disk), read-only, addressed by the file's actual in-repo path (so the tab/breadcrumbs
    // point at the real file), with the new side showing the file's content sourced from the
    // local node's storage and the old side empty (the file is added by the patch)
    const diff = await browser.executeWorkbench(async (vscode: typeof VsCode) => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as {
        original?: VsCode.Uri
        modified?: VsCode.Uri
      }

      async function readSide(uri: VsCode.Uri | undefined) {
        if (!uri) {
          return undefined
        }
        const text = (await vscode.workspace.openTextDocument(uri)).getText()

        return { scheme: uri.scheme, path: uri.path, text }
      }

      return {
        isWritable: vscode.workspace.fs.isWritableFileSystem('radicle-patch'),
        original: await readSide(input?.original),
        modified: await readSide(input?.modified),
      }
    })

    expect(diff.isWritable).toBe(false)
    expect(diff.modified?.scheme).toBe('radicle-patch')
    expect(diff.original?.scheme).toBe('radicle-patch')
    expect(diff.modified?.path).toBe('/hello.txt')
    expect(diff.original?.path).toBe('/hello.txt')
    expect(diff.modified?.text).toBe('Hello, World!\n')
    expect(diff.original?.text).toBe('')

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

  it('serves modified, deleted and binary patch file diffs from local storage', async () => {
    const rid = execFileSync('rad', ['inspect', '--rid'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim()
    const base = execFileSync('git', ['rev-parse', 'master'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim()
    const head = execFileSync('git', ['rev-parse', 'feat/hello-world'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim()

    // The provider serves each changed file's content straight from the local node's storage as
    // raw bytes: a modified file's old and new versions, a deleted file's old version, and a
    // binary file whose exact bytes (incl. a NUL and invalid UTF-8) survive intact — a string
    // round-trip, unlike this byte-accurate path, would corrupt them.
    async function readBlob(path: string, commit: string): Promise<number[]> {
      return await browser.executeWorkbench(
        async (vscode: typeof VsCode, repoId: string, atCommit: string, atPath: string) => {
          const uri = vscode.Uri.from({
            scheme: 'radicle-patch',
            path: atPath,
            query: JSON.stringify({ rid: repoId, commit: atCommit }),
          })

          return Array.from(await vscode.workspace.fs.readFile(uri))
        },
        rid,
        commit,
        path,
      )
    }

    function decode(bytes: number[]) {
      return Buffer.from(bytes).toString('utf-8')
    }

    expect(decode(await readBlob('/modify-me.txt', base))).toBe('original line\n')
    expect(decode(await readBlob('/modify-me.txt', head))).toBe('changed line\n')
    expect(decode(await readBlob('/delete-me.txt', base))).toBe('delete me\n')
    expect(await readBlob('/logo.bin', head)).toEqual(binaryFileBytes)

    // and a modified file's diff opens in a read-only editor showing both versions from storage
    await browser.executeWorkbench(
      async (vscode: typeof VsCode, repoId: string, oldCommit: string, newCommit: string) => {
        function build(commit: string) {
          return vscode.Uri.from({
            scheme: 'radicle-patch',
            path: '/modify-me.txt',
            query: JSON.stringify({ rid: repoId, commit }),
          })
        }
        await vscode.commands.executeCommand(
          'vscode.diff',
          build(oldCommit),
          build(newCommit),
          'modify-me.txt diff',
        )
      },
      rid,
      base,
      head,
    )

    let modifiedDiff: Awaited<ReturnType<typeof readActiveDiffSides>> | undefined
    await browser.waitUntil(
      async () => {
        modifiedDiff = await readActiveDiffSides()

        return modifiedDiff.modified?.path === '/modify-me.txt'
      },
      { timeoutMsg: 'expected the modified-file diff editor to open' },
    )

    expect(modifiedDiff!.original?.text).toBe('original line\n')
    expect(modifiedDiff!.modified?.text).toBe('changed line\n')
    expect(modifiedDiff!.modified?.scheme).toBe('radicle-patch')

    await closeActiveEditor()
  })

  it("opens all of a patch's changed files in one multi-file diff editor", async () => {
    const rid = execFileSync('rad', ['inspect', '--rid'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim()
    const base = execFileSync('git', ['rev-parse', 'master'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim()
    const head = execFileSync('git', ['rev-parse', 'feat/hello-world'], {
      cwd: workspacePath,
      encoding: 'utf-8',
    }).trim()

    // the seeded patch adds hello.txt & logo.bin, modifies modify-me.txt, deletes delete-me.txt.
    // Added files get no original (left) side and the deleted file no modified (right) side, all
    // served over the `radicle-patch:` scheme, exactly as the real command builds them.
    await browser.executeWorkbench(
      async (vscode: typeof VsCode, repoId: string, oldCommit: string, newCommit: string) => {
        function blob(commit: string, path: string) {
          return vscode.Uri.from({
            scheme: 'radicle-patch',
            path,
            query: JSON.stringify({ rid: repoId, commit }),
          })
        }

        function label(path: string) {
          return vscode.Uri.from({ scheme: 'radicle-patch', path })
        }

        const resources = [
          [label('/hello.txt'), undefined, blob(newCommit, '/hello.txt')],
          [label('/logo.bin'), undefined, blob(newCommit, '/logo.bin')],
          [
            label('/modify-me.txt'),
            blob(oldCommit, '/modify-me.txt'),
            blob(newCommit, '/modify-me.txt'),
          ],
          [label('/delete-me.txt'), blob(oldCommit, '/delete-me.txt'), undefined],
        ]

        await vscode.commands.executeCommand('vscode.changes', 'Patch changes', resources)
      },
      rid,
      base,
      head,
    )

    let multiDiff: { label: string; isMultiDiff: boolean } | undefined
    await browser.waitUntil(
      async () => {
        multiDiff = await browser.executeWorkbench((vscode: typeof VsCode) => {
          const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
          // `TabInputTextMultiDiff` exists at runtime (VS Code >= 1.86) but is not in the stable
          // `@types/vscode` yet, so duck-type its `textDiffs` array instead of `instanceof`-ing it
          const input = activeTab?.input as { textDiffs?: readonly unknown[] } | undefined

          return {
            label: activeTab?.label ?? '',
            isMultiDiff: Array.isArray(input?.textDiffs),
          }
        })

        // VS Code renders the multi-diff tab label as "<title> (<n> files)", counting all changed
        // files. `textDiffs` itself only lists entries with both sides present, so it excludes the
        // added, binary and deleted files; the label is the reliable "all 4 opened" signal.
        return multiDiff.isMultiDiff && multiDiff.label === 'Patch changes (4 files)'
      },
      { timeoutMsg: 'expected a multi-file diff editor with all 4 changed files to open' },
    )

    await closeActiveEditor()
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
  // seed base files the patch will later modify and delete, to cover those diff cases
  await zx`echo 'original line' > modify-me.txt`
  await zx`echo 'delete me' > delete-me.txt`
  await zx`git add README.md modify-me.txt delete-me.txt`
  await zx`git commit -m 'adds readme' --no-gpg-sign`
  await radInitPublicRepo(workspacePath)
  await zx`git checkout -b feat/hello-world`
  // the patch adds a text file and a binary file, modifies one file and deletes another,
  // so the changed-files diff covers added, binary, modified and deleted cases
  await zx`echo 'Hello, World!' > hello.txt`
  await zx`echo 'changed line' > modify-me.txt`
  await zx`rm delete-me.txt`
  writeFileSync(join(workspacePath, 'logo.bin'), Buffer.from(binaryFileBytes))
  await zx`git add -A`
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
  // Match the `monaco-list-row` class as a whole space-delimited token, not a substring:
  // a bare `contains(@class, "monaco-list-row")` also matches the `monaco-list-rows` wrapper
  // that holds every row, whose combined text spans all rows. That made "row X shows/hides the
  // marker" assertions read a sibling's marker off the wrapper and flake.
  //
  // Tree rows cloned into VS Code's sticky-scroll container are excluded: they linger hidden
  // after an expanded row scrolls or collapses, shadowing the real row.
  return (
    `//div[contains(@class, "sidebar")]//div[contains(concat(" ", normalize-space(@class), " "), " monaco-list-row ")]` +
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
 * Reads both sides of the currently active diff editor, returning each side's URI scheme and
 * path, its text, and its raw bytes (so binary content can be asserted exactly).
 */
async function readActiveDiffSides() {
  return await browser.executeWorkbench(async (vscode: typeof VsCode) => {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as {
      original?: VsCode.Uri
      modified?: VsCode.Uri
    }

    async function readSide(uri: VsCode.Uri | undefined) {
      if (!uri) {
        return undefined
      }
      const bytes = await vscode.workspace.fs.readFile(uri)
      let text = ''
      try {
        // opening binary content as a text document may fail; bytes are asserted for those
        text = (await vscode.workspace.openTextDocument(uri)).getText()
      } catch {
        text = ''
      }

      return { scheme: uri.scheme, path: uri.path, text, bytes: Array.from(bytes) }
    }

    return {
      original: await readSide(input?.original),
      modified: await readSide(input?.modified),
    }
  })
}

async function closeActiveEditor() {
  await browser.executeWorkbench(async (vscode: typeof VsCode) => {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  })
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
 * Dismisses any visible VS Code notification toasts. A patch mutation (status change, title
 * or description edit) triggers an "Updated and announced patch" toast that otherwise lingers
 * into the next test and can intercept a click meant for a webview button behind it.
 */
async function dismissAllNotifications() {
  await browser.executeWorkbench(async (vscode: typeof VsCode) => {
    await vscode.commands.executeCommand('notifications.clearAll')
  })
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
    await dismissAllNotifications()
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

describe('Checkout affordances gated by patch status,', () => {
  const patchToArchiveTitle = 'feat: patch to archive'
  let workbench: Workbench
  let workspacePath: string
  let patchToArchiveId: string

  before(async () => {
    workbench = await browser.getWorkbench()
    workspacePath = process.env['RAD_E2E_WORKSPACE'] ?? ''
  })

  afterEach(async () => {
    await switchBackToMainFrame()
  })

  it('prominently offers checkout for a non-checked-out open patch', async () => {
    patchToArchiveId = await seedExtraPatch(
      workspacePath,
      'feat/to-archive',
      patchToArchiveTitle,
    )
    // pushing a patch checks its branch out (radicle sets its upstream to `rad/patches/<id>`);
    // switch back to the default branch so this patch is not the checked-out one, making
    // "Check Out Patch Branch" (rather than "Check Out Default Branch") the offered affordance
    await zx`git checkout master`
    await workbench.executeCommand('Refresh All Patch Data')

    await expect(await findPatchItem(patchToArchiveTitle)).toBeDisplayed()
    await expectPatchItemCheckedOutMarker(patchToArchiveTitle, false)

    // the inline "Check Out Patch Branch" button shows on the list item while the patch is open
    await expectPatchItemInlineButtonPresence(
      patchToArchiveTitle,
      selectors.checkOutPatchInlineButton,
      true,
    )

    // and the detail webview offers its own prominent "Check Out" button
    await openPatchDetails(patchToArchiveTitle)
    const webview = await switchToPatchDetailWebview(workbench)

    await expect($(selectors.checkOutPatchBranchButton)).toBeDisplayed()

    await webview.close()
  })

  it('stops prominently offering checkout once the patch is archived', async () => {
    cd(workspacePath)
    await zx`rad patch archive ${patchToArchiveId}`
    await workbench.executeCommand('Refresh All Patch Data')

    await browser.waitUntil(
      async () =>
        await (await findPatchItem(patchToArchiveTitle))
          .$(selectors.archivedPatchIcon)
          .isExisting(),
      { timeoutMsg: 'expected the patch item to show the archived status icon' },
    )

    // the prominent inline list button is gone
    await expectPatchItemInlineButtonPresence(
      patchToArchiveTitle,
      selectors.checkOutPatchInlineButton,
      false,
    )

    // and so is the detail webview's prominent "Check Out" button (the ever-present "Reveal"
    // button confirms the webview did load, so the absence is real, not a not-yet-rendered panel)
    await openPatchDetails(patchToArchiveTitle)
    const webview = await switchToPatchDetailWebview(workbench)

    await expect($(selectors.revealPatchButton)).toBeDisplayed()
    await expect($(selectors.checkOutPatchBranchButton)).not.toBeDisplayed()

    await webview.close()
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
      timeoutMsg: `expected the item labeled "${label}" to ${
        isShown ? 'show' : 'not show'
      } the checked-out marker. Last visible row text: "${lastRowText}"`,
    },
  )
}

/**
 * Hovers the patch item labeled `label` (so its inline action bar materializes) and asserts
 * whether the inline button matching `buttonSelector` is present. The always-present "Open
 * Patch Details" inline button is used as a sentinel that the action bar rendered, so a
 * `false` assertion means the button is genuinely absent rather than not-yet-rendered.
 */
async function expectPatchItemInlineButtonPresence(
  label: string,
  buttonSelector: string,
  shouldBePresent: boolean,
) {
  await browser.waitUntil(
    async () => {
      // park the pointer on neutral ground first so hovering the row fires a fresh mouseenter
      await $('.statusbar').moveTo()
      const patchItem = await findPatchItem(label)
      await patchItem.moveTo()

      const isActionBarRendered = await patchItem
        .$(selectors.openPatchDetailsButton)
        .isExisting()
      if (!isActionBarRendered) {
        return false
      }

      return (await patchItem.$(buttonSelector).isExisting()) === shouldBePresent
    },
    {
      timeoutMsg: `expected the inline button "${buttonSelector}" to ${
        shouldBePresent ? 'be' : 'not be'
      } present on the item labeled "${label}"`,
    },
  )

  // park the pointer again so a lingering hover does not stall follow-up re-renders
  await $('.statusbar').moveTo()
}

async function findAndFillInput(selector: string, value: string) {
  const selectAllModifier = process.platform === 'darwin' ? Key.Command : Key.Ctrl
  await $(selector).click()
  await browser.keys([selectAllModifier, 'a'])
  await browser.keys(Key.Backspace)
  await browser.keys(value.split(''))
}
