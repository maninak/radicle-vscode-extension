import type * as VsCode from 'vscode'
import type { Workbench } from 'wdio-vscode-service'
import { browser } from '@wdio/globals'
import { $, cd } from 'zx'
import { httpdHost } from '../constants'
import { openRadicleViewContainer } from '../helpers/actions'
import {
  areStringArraysEqual,
  expectNotificationToContain,
  expectStandardSidebarViewsToBeVisible,
} from '../helpers/assertions'
import { getWorkerHttpdPort } from '../helpers/paths'
import { getFirstWelcomeViewText } from '../helpers/queries'
import { startWorkerNodeAndHttpd, stopWorkerNodeAndHttpd } from '../helpers/testSandbox'

// This worker's own node home and a valid alternative copied from it on demand. Both are
// resolved in `before` from the per-worker env injected by the harness.
let workerNodeHomePath: string
let workerWorkspacePath: string
let altNodeHomePath: string

const unreachableHttpApiEndpoint = 'http://127.0.0.1:6174'

const pathToRadBinaryConfig = 'radicle.advanced.pathToRadBinary'
const pathToNodeHomeConfig = 'radicle.advanced.pathToNodeHome'
const httpApiEndpointConfig = 'radicle.advanced.httpApiEndpoint'

// A path that surely holds no Radicle identity, used to drive the "no identity" code path.
const homeWithoutIdentity = '/tmp'

describe('Settings', () => {
  let workbench: Workbench
  let identityDid: string
  let workerIndex: number
  let reachableHttpApiEndpoint: string

  before(async () => {
    workbench = await browser.getWorkbench()
    workerNodeHomePath = process.env['RAD_E2E_NODE_HOME'] ?? ''
    workerWorkspacePath = process.env['RAD_E2E_WORKSPACE'] ?? ''
    altNodeHomePath = `${workerNodeHomePath}.alt`
    // spin up this worker's own httpd so the reachable-endpoint test has something to hit,
    // without the suite depending on a shared httpd being up on a fixed port
    workerIndex = Number(process.env['RAD_E2E_WORKER_INDEX'] ?? '0')
    await startWorkerNodeAndHttpd(workerIndex, getWorkerHttpdPort(workerIndex))
    reachableHttpApiEndpoint = `http://${httpdHost}:${getWorkerHttpdPort(workerIndex)}`
    await ensureWorkspaceIsRadInitialized()
    identityDid = (await $`rad self --did`).stdout.trim()
  })

  describe('VS Code, when the "Path to Rad Binary" setting is updated,', () => {
    before(async () => {
      await openRadicleViewContainer(workbench)
      await expectStandardSidebarViewsToBeVisible(workbench)
    })

    afterEach(async () => {
      await unsetConfig(pathToRadBinaryConfig)
      await expectStandardSidebarViewsToBeVisible(workbench)
      await removeAltNodeHome()
    })

    it('warns the user if no rad binary resolves at the configured path', async () => {
      await setConfig(pathToRadBinaryConfig, '/tmp')
      await expectRadBinaryNotFound(workbench)
    })

    it('recognizes the rad binary when a valid path is configured', async () => {
      await createAltNodeHome()
      await setConfig(pathToRadBinaryConfig, `${altNodeHomePath}/bin/rad`)

      await expectStandardSidebarViewsToBeVisible(workbench)
    })

    it('recognizes the rad binary appearing at the configured path after the fact', async () => {
      await setConfig(pathToRadBinaryConfig, `${altNodeHomePath}/bin/rad`)
      await expectRadBinaryNotFound(workbench)

      await createAltNodeHome()
      await expectStandardSidebarViewsToBeVisible(workbench)
    })
  })

  describe('VS Code, when the "Path to Node Home" setting is updated,', () => {
    const noIdentityLogText = 'No Radicle identity is currently stored'

    afterEach(async () => {
      await unsetConfig(pathToNodeHomeConfig)
      await removeAltNodeHome()
    })

    it('drops the resolved identity when none exists at the configured home', async () => {
      await clearRadicleLog()
      await setConfig(pathToNodeHomeConfig, homeWithoutIdentity)

      await expectRadicleLogToContain(noIdentityLogText)
    })

    it('resolves the identity when a valid home is configured', async () => {
      await createAltNodeHome()
      await clearRadicleLog()
      await setConfig(pathToNodeHomeConfig, altNodeHomePath)

      await expectRadicleLogToContain(identityDid)
    })

    it('resolves the identity appearing at the configured home after the fact', async () => {
      await clearRadicleLog()
      await setConfig(pathToNodeHomeConfig, altNodeHomePath)
      await expectRadicleLogToContain(noIdentityLogText)

      await createAltNodeHome()
      await expectRadicleLogToContain(identityDid)
    })
  })

  describe('VS Code, when the "HTTP API Endpoint" setting is updated,', () => {
    afterEach(async () => {
      await unsetConfig(httpApiEndpointConfig)
    })

    it('connects to the Radicle HTTP API when a reachable endpoint is configured', async () => {
      await setConfig(httpApiEndpointConfig, reachableHttpApiEndpoint)
      await expectNotificationToContain(workbench, 'Connected with Radicle HTTP API')
    })

    it('warns the user if no Radicle HTTP API responds at the configured endpoint', async () => {
      await setConfig(httpApiEndpointConfig, unreachableHttpApiEndpoint)
      await expectNotificationToContain(workbench, 'Failed', 'Radicle HTTP API')
    })
  })

  after(() => {
    stopWorkerNodeAndHttpd(workerIndex)
  })
})

/**
 * Makes the suite runnable on its own: if the opened workspace is not yet a Radicle repo
 * (e.g. the onboarding suite did not run before it), initializes one. Idempotent.
 */
async function ensureWorkspaceIsRadInitialized() {
  cd(workerWorkspacePath)
  const isRadInitialized = await $`rad inspect --rid`.quiet().then(
    () => true,
    () => false,
  )
  if (isRadInitialized) {
    return
  }

  await $`git init -b master .`
  await $`git config --local user.email "test@radicle.dev"`
  await $`git config --local user.name "Radicle Test"`
  await $`echo "# Basic Repo" > README.md`
  await $`git add README.md`
  await $`git commit -m 'adds readme' --no-gpg-sign`
  await $`rad init --private --default-branch master --name "Repo" --description "Test repo" --no-confirm`
}

/** Copies the sandbox identity into `altNodeHomePath`. */
async function createAltNodeHome() {
  await $`mkdir -p ${altNodeHomePath}/keys`
  await $`cp -r ${workerNodeHomePath}/bin ${altNodeHomePath}/bin`
  await $`cp ${workerNodeHomePath}/config.json ${altNodeHomePath}/config.json`
  // Copy the key files into `keys/`, preserving the secret key's permissions
  await $`cp -p ${workerNodeHomePath}/keys/radicle ${workerNodeHomePath}/keys/radicle.pub ${altNodeHomePath}/keys/`
}

async function removeAltNodeHome() {
  await $`rm -rf ${altNodeHomePath}`
}

// HACK(wdio): sets config via the VS Code API instead of driving the Settings UI, because
// wdio-vscode-service@6.1.4 resolves outdated locators for VS Code >= 1.100 (lexical version
// comparison) breaking its SettingsEditor page objects. Remove when the service is fixed.
async function setConfig(configKey: string, value: string) {
  await browser.executeWorkbench(
    async (vscode: typeof VsCode, key: string, val: string) => {
      const config = vscode.workspace.getConfiguration()
      await config.update(key, val, vscode.ConfigurationTarget.Global)
    },
    configKey,
    value,
  )
}

async function unsetConfig(configKey: string) {
  await browser.executeWorkbench(async (vscode: typeof VsCode, key: string) => {
    const config = vscode.workspace.getConfiguration()
    await config.update(key, undefined, vscode.ConfigurationTarget.Global)
  }, configKey)
}

async function revealRadicleLog() {
  await browser.executeWorkbench(async (vscode: typeof VsCode) => {
    await vscode.commands.executeCommand('radicle.showExtensionLog')
  })
}

// Empties the Output panel so a following assertion only sees output produced by the action
// under test, not leftovers from an earlier one
async function clearRadicleLog() {
  await revealRadicleLog()
  await browser.executeWorkbench(async (vscode: typeof VsCode) => {
    await vscode.commands.executeCommand('workbench.output.action.clearOutput')
  })
}

// Reads the entire Radicle Output channel by triggering the native select-all and copy
// actions on the focused Output editor, then reading the system clipboard. Reading the whole
// channel sidesteps the Output editor virtualizing or auto-scrolling the line we care about
// out of the rendered DOM, and the unrelated entries logged around it become harmless since we
// substring-search the full text.
async function readRadicleLog(): Promise<string> {
  await revealRadicleLog()
  // macOS selects-all and copies with Cmd, while Linux and Windows use Ctrl.
  const selectAllAndCopyModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await browser.keys([selectAllAndCopyModifier, 'a'])
  await browser.keys([selectAllAndCopyModifier, 'c'])
  const clipboardText = await browser.executeWorkbench(async (vscode: typeof VsCode) => {
    return await vscode.env.clipboard.readText()
  })

  return clipboardText
}

/** Waits until our Radicle Output channel contains all the given substrings. */
async function expectRadicleLogToContain(...requiredSubstrings: string[]) {
  let logText = ''
  try {
    await browser.waitUntil(async () => {
      logText = await readRadicleLog()
      const hasAllSubstrings = requiredSubstrings.every((substring) =>
        logText.includes(substring),
      )

      return hasAllSubstrings
    })
  } catch {
    throw new Error(
      `expected the Radicle output to contain "${requiredSubstrings.join('" and "')}", ` +
        `but the channel held:\n${logText}`,
    )
  }
}

async function expectRadBinaryNotFound(workbench: Workbench) {
  const radBinaryNotFoundWelcomeText = [
    'Failed resolving the Radicle CLI binary.',
    "Please ensure it is installed on your machine and either that it is globally accessible in the shell as `rad` or that its path is correctly defined in the extension's settings.",
    "Please expect the extention's capabilities to remain severely limited until this issue is resolved.",
  ]
  await browser.waitUntil(async () =>
    areStringArraysEqual(
      await getFirstWelcomeViewText(workbench),
      radBinaryNotFoundWelcomeText,
    ),
  )
}
