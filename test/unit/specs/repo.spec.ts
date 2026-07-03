import type { Mock } from 'vitest'
import type { RepoListItem } from '../../../src/stores/repoListStore'
import { ref, shallowRef } from '@vue/reactivity'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, window } from 'vscode'
import { execRad } from '../../../src/helpers'
import { getRepoRoot, showLog } from '../../../src/utils'
import { notifyUserAboutFetchError } from '../../../src/ux/httpdConnection'
import { pickAndCloneRadicleRepo } from '../../../src/ux/repo'

// The repo picker reads its list and refresh state from `repoListStore`. We back the mocked
// store with real `@vue/reactivity` refs so the picker's reactive wiring (live items, busy
// spinner) is exercised: mutating a ref here re-runs the effect inside the code under test.
const storeRepos = shallowRef<RepoListItem[]>([])
const storeIsRefreshing = ref(false)
const refreshRepoListMock = vi.fn<() => Promise<{ error?: unknown } | undefined>>()

vi.mock('../../../src/helpers', () => ({ execRad: vi.fn() }))
vi.mock('../../../src/utils', () => ({ getRepoRoot: vi.fn(), log: vi.fn(), showLog: vi.fn() }))
vi.mock('../../../src/ux/httpdConnection', () => ({ notifyUserAboutFetchError: vi.fn() }))
vi.mock('../../../src/stores', () => ({
  useRepoListStore: () => ({
    getRepos: () => storeRepos.value,
    get isRefreshing() {
      return storeIsRefreshing.value
    },
    refreshRepoList: async () => await refreshRepoListMock(),
  }),
}))

interface RepoQuickPickItem {
  label: string
  description: string
  detail?: string
  rid: string
}
interface FakeQuickPick {
  items: RepoQuickPickItem[]
  selectedItems: RepoQuickPickItem[]
  busy: boolean
  onDidAccept: Mock<(callback: () => void) => { dispose: Mock }>
  onDidHide: Mock<(callback: () => void) => { dispose: Mock }>
  show: Mock
  hide: Mock
  dispose: Mock
}
interface ExecRadOptions {
  cwd: string
  timeout: number
  shouldLog: boolean
}

const getRepoRootMock = getRepoRoot as unknown as Mock
const showLogMock = showLog as unknown as Mock
const notifyUserAboutFetchErrorMock = notifyUserAboutFetchError as unknown as Mock
const showInformationMessageMock = window.showInformationMessage as unknown as Mock
const showErrorMessageMock = window.showErrorMessage as unknown as Mock
const withProgressMock = window.withProgress as unknown as Mock
const createQuickPickMock = window.createQuickPick as unknown as Mock<() => FakeQuickPick>
const execRadMock = execRad as unknown as Mock<
  (args: string[], options: ExecRadOptions) => unknown
>
const showOpenDialogMock = window.showOpenDialog as unknown as Mock<
  (options: unknown) => Promise<{ fsPath: string }[] | undefined>
>
const executeVsCodeCmdMock = commands.executeCommand as unknown as Mock<
  (command: string, uri: { fsPath: string }, options: { forceNewWindow: boolean }) => unknown
>

const heartwood: RepoListItem = {
  rid: 'rad:zHEART',
  name: 'heartwood',
  description: 'Radicle Heartwood Protocol & Stack',
  seeding: 42,
}

/** Kicks off the clone flow and returns the just-created (still-open) fake quick pick. */
function startClone(): { done: Promise<void>; quickPick: FakeQuickPick } {
  const done = pickAndCloneRadicleRepo()
  const quickPick = createQuickPickMock.mock.results.at(-1)!.value as FakeQuickPick

  return { done, quickPick }
}

function acceptFirstItem(quickPick: FakeQuickPick): void {
  quickPick.selectedItems = [quickPick.items[0]!]
  quickPick.onDidAccept.mock.calls[0]![0]()
}

function pickRepoLocation(fsPath: string): void {
  showOpenDialogMock.mockResolvedValue([{ fsPath }])
}

describe('pickAndCloneRadicleRepo()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Run the wrapped task so the progress wrapper is transparent to the assertions.
    withProgressMock.mockImplementation((_options: unknown, task: () => unknown) => task())
    getRepoRootMock.mockReturnValue(undefined)
    storeRepos.value = []
    storeIsRefreshing.value = false
    refreshRepoListMock.mockResolvedValue(undefined)
    delete process.env['RAD_E2E_CLONE_PARENT_DIR']
  })

  describe('The offered repo list', () => {
    it("renders the store's items in the order it provides (the store sorts, not the picker)", async () => {
      // The store returns repos already capped and sorted most-seeded-first, so the picker
      // must render them verbatim without re-sorting.
      storeRepos.value = [
        { rid: 'rad:zHIGH', name: 'high', description: '', seeding: 50 },
        { rid: 'rad:zMID', name: 'mid', description: '', seeding: 20 },
        { rid: 'rad:zLOW', name: 'low', description: '', seeding: 5 },
      ]

      const { done, quickPick } = startClone()

      expect(quickPick.items.map((item) => item.label)).toEqual(['high', 'mid', 'low'])
      quickPick.hide()
      await done
    })

    it('maps each repo into a labelled, seed-annotated pick item', async () => {
      storeRepos.value = [heartwood]

      const { done, quickPick } = startClone()

      expect(quickPick.items[0]).toMatchObject({
        label: 'heartwood',
        detail: 'Radicle Heartwood Protocol & Stack',
        rid: 'rad:zHEART',
      })

      expect(quickPick.items[0]!.description).toContain('rad:zHEART')
      quickPick.hide()
      await done
    })

    it('reflects the store refresh state as the picker busy spinner', async () => {
      const { done, quickPick } = startClone()

      expect(quickPick.busy).toBe(false)

      storeIsRefreshing.value = true

      expect(quickPick.busy).toBe(true)

      storeIsRefreshing.value = false

      expect(quickPick.busy).toBe(false)
      quickPick.hide()
      await done
    })

    it('updates the offered items live as the background refresh brings in new repos', async () => {
      storeRepos.value = [heartwood]

      const { done, quickPick } = startClone()

      expect(quickPick.items).toHaveLength(1)

      storeRepos.value = [
        heartwood,
        { rid: 'rad:zNEW', name: 'newlyfetched', description: '', seeding: 1 },
      ]

      expect(quickPick.items).toHaveLength(2)
      expect(quickPick.items.map((item) => item.label)).toContain('newlyfetched')
      quickPick.hide()
      await done
    })
  })

  describe('When the background refresh fails', () => {
    it('notifies and hides the picker when nothing is cached to offer', async () => {
      const error = new Error('httpd unreachable')
      refreshRepoListMock.mockResolvedValue({ error })
      storeRepos.value = []

      const { done } = startClone()
      await done

      expect(notifyUserAboutFetchErrorMock).toHaveBeenCalledWith(error)
      expect(execRadMock).not.toHaveBeenCalled()
    })

    it('keeps offering the cached repos without notifying', async () => {
      refreshRepoListMock.mockResolvedValue({ error: new Error('httpd unreachable') })
      storeRepos.value = [heartwood]

      const { done, quickPick } = startClone()
      await Promise.resolve()

      expect(notifyUserAboutFetchErrorMock).not.toHaveBeenCalled()
      expect(quickPick.hide).not.toHaveBeenCalled()
      quickPick.hide()
      await done
    })
  })

  describe('When the user cancels', () => {
    it('does nothing if no repo is picked', async () => {
      storeRepos.value = [heartwood]

      const { done, quickPick } = startClone()
      quickPick.hide()
      await done

      expect(showOpenDialogMock).not.toHaveBeenCalled()
      expect(execRadMock).not.toHaveBeenCalled()
    })

    it('does not clone if no folder is picked', async () => {
      storeRepos.value = [heartwood]
      showOpenDialogMock.mockResolvedValue(undefined)

      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done

      expect(execRadMock).not.toHaveBeenCalled()
    })
  })

  describe('Cloning', () => {
    beforeEach(() => {
      storeRepos.value = [heartwood]
      pickRepoLocation('/home/me/code')
      execRadMock.mockReturnValue({ stdout: '' })
      showInformationMessageMock.mockResolvedValue(undefined)
    })

    it('checks out into a subfolder named after the repo, inside the picked location', async () => {
      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done
      const [args, options] = execRadMock.mock.calls[0]!

      expect(args[2]).toBe('/home/me/code/heartwood')
      expect(options.cwd).toBe('/home/me/code')
    })

    it('opens exactly the checked-out folder when the user chooses to open it', async () => {
      showInformationMessageMock.mockResolvedValue('Open in new window')

      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done
      const [command, uri, options] = executeVsCodeCmdMock.mock.calls[0]!

      expect(command).toBe('vscode.openFolder')
      expect(uri.fsPath).toBe('/home/me/code/heartwood')
      expect(options).toEqual({ forceNewWindow: true })
    })
  })

  describe('When cloning fails', () => {
    beforeEach(() => {
      storeRepos.value = [heartwood]
      pickRepoLocation('/home/me/code')
      execRadMock.mockReturnValue({ errorCode: 1 })
    })

    it('reports the failure, offers the log, and opens no folder', async () => {
      showErrorMessageMock.mockResolvedValue('Show output')

      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done

      expect(showErrorMessageMock).toHaveBeenCalled()
      expect(showLogMock).toHaveBeenCalled()
      expect(executeVsCodeCmdMock).not.toHaveBeenCalled()
    })

    it('does not open the log when the failure prompt is dismissed', async () => {
      showErrorMessageMock.mockResolvedValue(undefined)

      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done

      expect(showLogMock).not.toHaveBeenCalled()
    })
  })

  describe('The e2e clone-destination seam', () => {
    beforeEach(() => {
      storeRepos.value = [heartwood]
      execRadMock.mockReturnValue({ stdout: '' })
      showInformationMessageMock.mockResolvedValue(undefined)
    })

    it('clones into the env-provided folder without opening the native picker', async () => {
      process.env['RAD_E2E_CLONE_PARENT_DIR'] = '/tmp/e2e-clones'

      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done
      const [args, options] = execRadMock.mock.calls[0]!

      expect(showOpenDialogMock).not.toHaveBeenCalled()
      expect(args[2]).toBe('/tmp/e2e-clones/heartwood')
      expect(options.cwd).toBe('/tmp/e2e-clones')
    })

    it('falls back to the native picker when the env var is unset', async () => {
      showOpenDialogMock.mockResolvedValue(undefined)

      const { done, quickPick } = startClone()
      acceptFirstItem(quickPick)
      await done

      expect(showOpenDialogMock).toHaveBeenCalled()
    })
  })
})
