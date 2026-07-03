import * as fs from 'node:fs/promises'
import Path, { sep } from 'node:path'
import {
  EventEmitter,
  MarkdownString,
  type TextDocumentShowOptions,
  ThemeColor,
  ThemeIcon,
  type TreeDataProvider,
  type TreeItem,
  TreeItemCollapsibleState,
  Uri,
} from 'vscode'
import { extTempDir } from '../constants'
import {
  getFirstAndLatestRevisions,
  isLocalIdAuthedToEditPatchStatus,
  loadFileAtCommit,
  loadPatchFilechanges,
} from '../helpers'
import { useEnvStore, usePatchStore } from '../stores'
import { type AugmentedPatch, isPatch, type Patch } from '../types'
import {
  assertUnreachable,
  capitalizeFirstLetter,
  getIdentityAliasOrId,
  getTimeAgo,
  log,
  shortenHash,
} from '../utils'

const dot = '·'
const checkmark = '✓'

let timesPatchListFetchErroredConsecutively = 0

// TODO: maninak show in item and tooltip if the chosen revision is approved, by whom and when

export interface FilechangeNode {
  relativeInRepoUrl: string
  oldVersionUrl?: string
  newVersionUrl?: string
  patch: AugmentedPatch
  getTreeItem: () => ReturnType<(typeof patchesTreeDataProvider)['getTreeItem']>
}

/**
 * PRE-CONDITIONS:
 * - Must match an entry defined in package.json's `contributes.views`
 */
export const patchesViewId = 'patches-view'

/**
 * Event emitter dedicated to refreshing the Patch view's tree data.
 */
const rerenderPatchesViewEventEmitter = new EventEmitter<
  string | AugmentedPatch | (string | AugmentedPatch)[] | undefined
>()

export function rerenderSomeItemsInPatchesView(
  patchesMatchingItems: AugmentedPatch | AugmentedPatch[],
) {
  rerenderPatchesViewEventEmitter.fire(patchesMatchingItems)
}

export function rerenderAllItemsInPatchesView() {
  rerenderPatchesViewEventEmitter.fire(undefined)
}

export const patchesTreeDataProvider: TreeDataProvider<
  string | AugmentedPatch | FilechangeNode
> = {
  getTreeItem: (elem) => {
    if (typeof elem === 'string') {
      return { description: elem }
    } else if (isPatch(elem)) {
      const patch = elem
      const edgeRevisions = getFirstAndLatestRevisions(patch)
      const localIdentityDid = useEnvStore().localIdentity?.DID
      const delegates = useEnvStore().currentRepoInfo?.delegates
      const traitStatusEditable =
        localIdentityDid &&
        delegates &&
        isLocalIdAuthedToEditPatchStatus(
          patch.state.status,
          delegates,
          edgeRevisions.firstRevision,
          localIdentityDid,
        )
          ? ':status-editable'
          : ''
      const isCheckedOut = patch.id === usePatchStore().checkedOutPatch?.id

      const treeItem: TreeItem = {
        id: patch.id,
        contextValue: `patch:status-${patch.state.status}${traitStatusEditable}:checked-out-${isCheckedOut}`,
        iconPath: getThemeIconForPatch(patch),
        label: `${isCheckedOut ? `❬${checkmark}❭ ` : ''}${patch.title}`,
        description: getPatchTreeItemDescription(patch, edgeRevisions),
        tooltip: getPatchTreeItemTooltip(patch, edgeRevisions, isCheckedOut),
        collapsibleState: TreeItemCollapsibleState.Collapsed,
      }

      return treeItem
    } else {
      const filechangeNode = elem

      // We can't put the code to construct the filechange TreeItem inside getTreeItem()
      // because we need to perform operations on the whole collection (e.g. sort, search for
      // and handle items with same filename differently, etc). Thus we define a "constructor"
      // inside getChildren() and call that in here.
      return filechangeNode.getTreeItem()
    }
  },
  getChildren: async (elem) => {
    const rid = useEnvStore().currentRepoId
    if (!rid) {
      // This trap should theoretically never be reached,
      // because `patches.view` has `"when": "radicle.isRadInitialized"`.
      return ['Unable to fetch Radicle Patches for non-Radicle-initialized workspace']
    }

    // get children of root
    if (!elem) {
      const patchStore = usePatchStore()
      patchStore.initStoreIfNeeded()
      const patches = patchStore.patches

      if (!patches) {
        setTimeout(() => {
          rerenderAllItemsInPatchesView()
        }, 3_000 * ++timesPatchListFetchErroredConsecutively)

        // TODO: maninak add button linking to see output?
        // TODO: maninak add button linking to specific config?
        return ['Failed listing Radicle patches. See the Output panel for details.']
      }
      timesPatchListFetchErroredConsecutively = 0

      if (!patches.length) {
        return undefined
      }

      const patchesSortedByRevisionTsPerStatus = [
        ...getPatchesOfStatusSortedByLatestRevisionFirst(patches, 'draft'),
        ...getPatchesOfStatusSortedByLatestRevisionFirst(patches, 'open'),
        ...getPatchesOfStatusSortedByLatestRevisionFirst(patches, 'archived'),
        ...getPatchesOfStatusSortedByLatestRevisionFirst(patches, 'merged'),
      ]

      return patchesSortedByRevisionTsPerStatus
    }

    // get children of patch
    else if (isPatch(elem)) {
      const patch = elem
      const { latestRevision } = getFirstAndLatestRevisions(patch)
      const oldVersionCommitSha = latestRevision.base
      const newVersionCommitSha = latestRevision.oid

      const { data: filechanges, error } = loadPatchFilechanges(
        rid,
        oldVersionCommitSha,
        newVersionCommitSha,
      )
      if (error) {
        return ['Patch details could not be resolved due to an error!']
      }

      // create a placeholder empty file used to diff added or removed files
      const emptyFileUrl = `${extTempDir}${sep}empty`

      try {
        await fs.mkdir(Path.dirname(emptyFileUrl), { recursive: true })
        await fs.writeFile(emptyFileUrl, '')
      } catch (error) {
        log(
          "Failed saving placeholder empty file to enable diff for Patch's changed files.",
          'error',
          (error as Partial<Error | undefined>)?.message,
        )
      }

      // TS can't see `rid`'s narrowing inside the hoisted function declaration below
      const narrowedRid = rid

      async function writeVersionOfFileToTempDir(
        commitSha: string,
        filePathAtCommit: string,
        tempFileUrl: string,
      ): Promise<void> {
        const { data: fileContent, error } = loadFileAtCommit(
          narrowedRid,
          commitSha,
          filePathAtCommit,
        )
        if (error) {
          throw error
        }
        await fs.mkdir(Path.dirname(tempFileUrl), { recursive: true })
        await fs.writeFile(tempFileUrl, fileContent)
      }

      const filechangeNodes: FilechangeNode[] = filechanges
        .map((filechange) => {
          const filePath = filechange.path
          const fileDir = Path.dirname(filePath)
          const filename = Path.basename(filePath)

          const oldVersionUrl = `${extTempDir}${sep}${shortenHash(
            oldVersionCommitSha,
          )}${sep}${fileDir}${sep}${filename}`
          // TODO: should the newVersionUrl be just the filechange.path (with full path to the
          // actual file on the fs) if the current git commit is same as newVersionCommitSha
          // and the file isn't on the git (un-)staged changes?
          const newVersionUrl = `${extTempDir}${sep}${shortenHash(
            newVersionCommitSha,
          )}${sep}${fileDir}${sep}${filename}`

          const node: FilechangeNode = {
            relativeInRepoUrl: filePath.includes(sep) ? filePath : `${sep}${filePath}`,
            oldVersionUrl,
            newVersionUrl,
            patch,
            getTreeItem: async () => {
              try {
                switch (filechange.status) {
                  case 'added':
                    await writeVersionOfFileToTempDir(
                      newVersionCommitSha,
                      filechange.path,
                      newVersionUrl,
                    )
                    break
                  case 'deleted':
                    await writeVersionOfFileToTempDir(
                      oldVersionCommitSha,
                      filechange.oldPath,
                      oldVersionUrl,
                    )
                    break
                  case 'modified':
                  case 'copied':
                  case 'moved':
                    await Promise.all([
                      writeVersionOfFileToTempDir(
                        oldVersionCommitSha,
                        filechange.oldPath,
                        oldVersionUrl,
                      ),
                      writeVersionOfFileToTempDir(
                        newVersionCommitSha,
                        filechange.path,
                        newVersionUrl,
                      ),
                    ])
                    break
                  default:
                    assertUnreachable(filechange.status)
                }
              } catch (error) {
                log(
                  `Failed saving temp files to enable diff for ${filePath}.`,
                  'error',
                  (error as Partial<Error | undefined>)?.message,
                )
              }

              const filechangeTreeItem: TreeItem = {
                id: `${patch.id} ${oldVersionCommitSha}..${newVersionCommitSha} ${filePath}`,
                contextValue: `filechange:${filechange.status}`,
                label: filename,
                description: fileDir === '.' ? undefined : fileDir,
                tooltip: `${
                  filechange.status === 'copied' || filechange.status === 'moved'
                    ? `${filechange.oldPath} ${filechange.status === 'copied' ? '↦' : '➟'} ${
                        filechange.path
                      }`
                    : filechange.path
                } ${dot} ${capitalizeFirstLetter(filechange.status)}`,
                resourceUri: Uri.file(filePath),
                command: {
                  command: 'radicle.openDiff',
                  title: `Open changes`,
                  tooltip: `Show this file's changes between its \
before-the-Patch version and its latest version committed in the Radicle Patch`,
                  arguments: [
                    Uri.file(filechange.status === 'added' ? emptyFileUrl : oldVersionUrl),
                    Uri.file(filechange.status === 'deleted' ? emptyFileUrl : newVersionUrl),
                    `${filename} (${shortenHash(oldVersionCommitSha)} ⟷ ${shortenHash(
                      newVersionCommitSha,
                    )}) ${capitalizeFirstLetter(filechange.status)}`,
                    { preview: true } satisfies TextDocumentShowOptions,
                  ],
                },
              }

              return filechangeTreeItem
            },
          }

          return node
        })
        .sort((n1, n2) => (n1.relativeInRepoUrl < n2.relativeInRepoUrl ? -1 : 0))

      return filechangeNodes.length
        ? filechangeNodes
        : [
            `No changes between latest revision's base "${shortenHash(
              latestRevision.base,
            )}" and head "${shortenHash(latestRevision.oid)}" commits.`,
          ]
    }

    return undefined
  },
  getParent: (elem) => {
    if (typeof elem === 'string' || isPatch(elem)) {
      return undefined
    } else {
      return elem.patch
    }
  },
  onDidChangeTreeData: rerenderPatchesViewEventEmitter.event,
} as const

function getPatchTreeItemDescription(
  patch: Patch,
  { latestRevision }: ReturnType<typeof getFirstAndLatestRevisions>,
) {
  const merge = patch.merges.at(-1)
  const description = `${getTimeAgo(
    merge?.timestamp ?? latestRevision.timestamp,
    'mini',
  )} ${dot} ${getIdentityAliasOrId(
    merge?.author ?? latestRevision.author,
  )} ${dot} ${shortenHash(patch.id)}`

  return description
}

function getPatchTreeItemTooltip(
  patch: Patch,
  { firstRevision, latestRevision }: ReturnType<typeof getFirstAndLatestRevisions>,
  isCheckedOut: boolean,
) {
  const separator = '—'
  const lineBreak = '\n\n'
  const sectionDivider = `${lineBreak}-----${lineBreak}`

  const checkedOutIndicator = isCheckedOut ? dat(`${separator} ${checkmark} Checked out`) : ''
  const latestMerge = [...patch.merges].sort((m1, m2) => m1.timestamp - m2.timestamp).at(-1)
  const shouldShowRevisionEvent = patch.revisions.length >= 2 // more than the initial Revision

  const tooltipTopSection = [
    `${getHtmlIconForPatch(patch)} ${dat(
      capitalizeFirstLetter(patch.state.status),
    )} ${separator} ${dat(patch.id)} ${checkedOutIndicator}`,
  ].join(lineBreak)

  const tooltipMiddleSection = [
    `**${patch.title}**`,
    `${firstRevision.description}`,
    `${patch.labels.reduce(
      (joinedLabels, label) => `${joinedLabels}${joinedLabels ? ' ' : ''}\`${label}\``,
      '',
    )}`,
  ].join(lineBreak)

  const tooltipBottomSection = [
    ...(latestMerge
      ? [
          `Merged by ${dat(getIdentityAliasOrId(latestMerge.author))} using revision ${dat(
            shortenHash(latestMerge.revision),
          )}${
            !shouldShowRevisionEvent
              ? ` at commit ${dat(shortenHash(latestMerge.commit))} `
              : ' '
          }${dat(`${getTimeAgo(latestMerge.timestamp)}`)}`,
        ]
      : []),
    ...(shouldShowRevisionEvent
      ? [
          `Last updated by ${dat(
            getIdentityAliasOrId(latestRevision.author),
          )} with revision ${dat(shortenHash(latestRevision.id))} at commit ${dat(
            shortenHash(latestRevision.oid),
          )} ${dat(`${getTimeAgo(latestRevision.timestamp)}`)}`,
        ]
      : []),
    `Created by ${dat(getIdentityAliasOrId(patch.author))} ${dat(
      `${getTimeAgo(firstRevision.timestamp)}`,
    )}`,
  ].join(lineBreak)

  const tooltip = new MarkdownString(
    [tooltipTopSection, tooltipMiddleSection, tooltipBottomSection].join(sectionDivider),
    true,
  )
  tooltip.supportHtml = true

  return tooltip
}

/**
 * Gives special Markdown formatting to a string value, further indicating that
 * it is data received from the API and not fixed tooltip copy.
 */
function dat(str: string): string {
  const formatingMarker = '_'

  return `${formatingMarker}${str}${formatingMarker}`
}

function getPatchesOfStatusSortedByLatestRevisionFirst<P extends Patch>(
  patches: P[],
  patchStatus: P['state']['status'],
): P[] {
  const sortedPatches = patches
    .filter((patch) => patch.state.status === patchStatus)
    .sort((p1, p2) => {
      const { latestRevision: latestP1Revision } = getFirstAndLatestRevisions(p1)
      const { latestRevision: latestP2Revision } = getFirstAndLatestRevisions(p2)

      return (
        (p2.merges.at(-1)?.timestamp ?? latestP2Revision.timestamp) -
        (p1.merges.at(-1)?.timestamp ?? latestP1Revision.timestamp)
      )
    })

  return sortedPatches
}

// eslint-disable-next-line consistent-return
function getThemeIconForPatch<P extends Patch>(patch: P): ThemeIcon {
  switch (patch.state.status) {
    case 'draft':
      return new ThemeIcon('git-pull-request-draft', new ThemeColor('patch.draft'))
    case 'open':
      return new ThemeIcon('git-pull-request', new ThemeColor('patch.open'))
    case 'archived':
      return new ThemeIcon('git-pull-request-closed', new ThemeColor('patch.archived'))
    case 'merged':
      return new ThemeIcon('git-merge', new ThemeColor('patch.merged'))
    default:
      assertUnreachable(patch.state)
  }
}

function getHtmlIconForPatch<P extends Patch>(patch: P): string {
  const icon = getThemeIconForPatch(patch)

  return `<span style="color:${getCssColor(icon.color)};">$(${icon.id})</span>`
}

function getCssColor(themeColor: ThemeColor | undefined): string {
  // see https://github.com/microsoft/vscode/issues/34411#issuecomment-329741042
  // @ts-expect-error id is set as private but there's no other API currently
  return `var(--vscode-${themeColor.id.replace('.', '-')})`
}
