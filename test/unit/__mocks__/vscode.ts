/**
 * Runtime stand-in for the `vscode` module, which is only injected by the editor at runtime
 * and cannot be imported in a plain Node process. The root Vitest config aliases `vscode` to
 * this file. Type-checking still resolves the real `@types/vscode`, so specs stay type-safe
 * against the genuine API while running against these spies.
 *
 * Only the surface used by the code under test is implemented. Extend as needed.
 */
import { vi } from 'vitest'

interface UriLike {
  scheme: string
  path: string
  fsPath: string
}

function file(fsPath: string): UriLike {
  return { scheme: 'file', path: fsPath, fsPath }
}

function joinPath(base: UriLike, ...segments: string[]): UriLike {
  const joinedPath = [base.fsPath, ...segments].join('/')

  return file(joinedPath)
}

// eslint-disable-next-line ts/naming-convention -- mirrors the `vscode` API export name
export const Uri = { file, joinPath }

// eslint-disable-next-line ts/naming-convention -- mirrors the `vscode` API export name
export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const

/**
 * A minimal stand-in for a `QuickPick` created via `window.createQuickPick()`. Fields are
 * plain and mutable. `onDidAccept`/`onDidHide` are spies that also record the registered
 * callback, so a test can accept the picker via `onDidAccept.mock.calls[0][0]()`; `hide()`
 * fires the registered hide callbacks, mirroring how dismissing the real widget resolves the
 * picker.
 */
function createQuickPick() {
  const hideCallbacks: (() => void)[] = []

  return {
    items: [] as unknown[],
    selectedItems: [] as unknown[],
    busy: false,
    placeholder: '',
    matchOnDescription: false,
    matchOnDetail: false,
    ignoreFocusOut: false,
    title: '',
    onDidAccept: vi.fn(() => ({ dispose: vi.fn() })),
    onDidHide: vi.fn((callback: () => void) => {
      hideCallbacks.push(callback)

      return { dispose: vi.fn() }
    }),
    show: vi.fn(),
    hide: vi.fn(() => hideCallbacks.forEach((callback) => callback())),
    dispose: vi.fn(),
  }
}

export const window = {
  // Forward to the task so the wrapped work actually runs, mirroring the real behaviour.
  withProgress: vi.fn((_options: unknown, task: (...args: unknown[]) => unknown) => task()),
  showQuickPick: vi.fn(),
  createQuickPick: vi.fn(createQuickPick),
  showOpenDialog: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
}

export const commands = {
  executeCommand: vi.fn(),
}

export const workspace = {
  getConfiguration: vi.fn(),
}

// eslint-disable-next-line ts/naming-convention -- mirrors the `vscode` API export name
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const
