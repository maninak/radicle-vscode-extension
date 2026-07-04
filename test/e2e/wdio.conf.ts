import type { Options } from '@wdio/types'
import { delimiter, join } from 'node:path'
import { $ as zx } from 'zx'
import {
  chromedriverPath,
  emulatedHomePath,
  httpdHost,
  radicleBinPath,
  rootDir,
  sandboxedPath,
  supportedVscodeVersion,
  wdioCachePath,
  wdioVideoPath,
} from './constants'
import { provisionChromeDriver } from './helpers/chromedriver'
import {
  getWorkerHomePath,
  getWorkerHttpdPort,
  getWorkerNodeHomePath,
  getWorkerRadicleBinPath,
  getWorkerWorkspacePath,
} from './helpers/paths'
import {
  emulateRadCliUninstalled,
  setupTestSandbox,
  setupWorkerSandbox,
  teardownTestSandbox,
  teardownWorkerSandbox,
} from './helpers/testSandbox'

// Done at module scope so every process loading this config (launcher, workers,
// and in turn VS Code + the extension host) inherits the emulated environment.
process.env['HOME'] = emulatedHomePath
process.env['USERPROFILE'] = emulatedHomePath
delete process.env['RAD_HOME']
// Sever any link to the user's real ssh-agent: the extension shells out to `ssh-add`
// (including `ssh-add -D`, which removes keys), which must never reach the real agent.
delete process.env['SSH_AUTH_SOCK']
// Unencrypted throwaway key, usable non-interactively without an ssh-agent.
process.env['RAD_PASSPHRASE'] = ''
process.env['PATH'] = sandboxedPath

// zx forwards a child's stderr to the console by default, flooding the runner with git and
// `rad` progress noise (branch switches, push hints, "patch opened" lines) from spec setup.
// Silence it globally; failures still surface via the thrown ProcessOutput and the spec
// reporter.
zx.quiet = true

let isTearingDown = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (isTearingDown) {
      return
    }
    isTearingDown = true
    void teardownTestSandbox().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  })
}

const shouldRecordVideo = Boolean(process.env['CI']) || Boolean(process.env['RECORD_VIDEO'])
const reporters: Options.Testrunner['reporters'] = shouldRecordVideo
  ? ['spec', ['video', { outputDir: wdioVideoPath }]]
  : ['spec']

const allE2eSpecs = [
  './specs/onboarding.spec.ts',
  './specs/settings.spec.ts',
  './specs/clone.spec.ts',
  './specs/patch-details.spec.ts',
]
// Optionally run a subset locally, e.g. `RAD_E2E_ONLY_SPEC=patch-details pnpm test:e2e`
const onlySpecFilter = process.env['RAD_E2E_ONLY_SPEC']
const selectedSpecs = onlySpecFilter
  ? allE2eSpecs.filter((spec) => spec.includes(onlySpecFilter))
  : allE2eSpecs

// patch-details.spec.ts is chronically flaky specifically on macOS CI runners: their slower
// Electron renderer intermittently stops repainting the Patches sidebar partway through the
// suite, cascading the whole worker. It's a render-timing/runner issue, not app logic, and it
// passes reliably locally and on Linux CI (which retains full coverage). Skip it on macOS CI.
// Tracked in https://github.com/maninak/radicle-vscode-extension/issues/195
const isMacosCi = Boolean(process.env['CI']) && process.platform === 'darwin'
const e2eSpecs = isMacosCi
  ? selectedSpecs.filter((spec) => !spec.includes('patch-details.spec.ts'))
  : selectedSpecs

/** Specs that mutate the network, so they get their own worker node + httpd. */
const networkMutatingSpecs = ['clone.spec.ts', 'patch-details.spec.ts']

function getWorkerIndexFromSpecs(specs: string[]): number {
  const matchedIndex = e2eSpecs.findIndex((spec) =>
    specs.some((runningSpec) => runningSpec.endsWith(spec.slice(1))),
  )

  return matchedIndex >= 0 ? matchedIndex : 0
}

// TODO: Bump webdriverio to v9 once wdio-vscode-service supports it
// Relevant PR: https://github.com/webdriverio-community/wdio-vscode-service/pull/159
// Relevant Issue: https://github.com/webdriverio-community/wdio-vscode-service/issues/140
export const config: Options.Testrunner = {
  runner: 'local',
  autoCompileOpts: {
    autoCompile: true,
    tsNodeOpts: {
      transpileOnly: true,
    },
  },
  capabilities: e2eSpecs.map((spec, workerIndex) => {
    const userSettings: Record<string, string | number | boolean | object> = {
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false,
    }
    // A network-mutating spec talks to its own worker-httpd (brought up in the spec's
    // `before`) rather than the shared read-only one. Set at launch so the extension
    // resolves it during activation, instead of depending on a runtime config change
    // landing.
    if (networkMutatingSpecs.some((mutatingSpec) => spec.endsWith(mutatingSpec))) {
      userSettings['radicle.advanced.httpApiEndpoint'] =
        `http://${httpdHost}:${getWorkerHttpdPort(workerIndex)}`
      // The extension runs `rad` commands in the extension host, whose PATH and HOME are
      // platform-dependent: on macOS, VS Code resolves the login shell's environment, which
      // omits the sandbox bin dir, so `rad` is not found and the default node home is wrong.
      // Pin the binary and node home so `rad` uses this worker's running, seeded node.
      userSettings['radicle.advanced.pathToRadBinary'] = join(
        getWorkerRadicleBinPath(workerIndex),
        'rad',
      )
      userSettings['radicle.advanced.pathToNodeHome'] = getWorkerNodeHomePath(workerIndex)
    }

    return {
      'browserName': 'vscode',
      'browserVersion': supportedVscodeVersion,
      'wdio:vscodeOptions': {
        extensionPath: rootDir,
        workspacePath: getWorkerWorkspacePath(workerIndex),
        userSettings,
        vscodeArgs: {
          'disable-extensions': true,
          'disable-workspace-trust': true,
          'disable-renderer-backgrounding': true,
          'disable-backgrounding-occluded-windows': true,
          'disable-background-timer-throttling': true,
        },
      },
      'wdio:chromedriverOptions': {
        binary: chromedriverPath,
      },
      'specs': [spec],
    }
  }),
  logLevel: 'warn',
  waitforTimeout: 10000,
  services: [['vscode', { cachePath: wdioCachePath }]],
  framework: 'mocha',
  reporters,
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  onPrepare: async () => {
    try {
      await provisionChromeDriver()
      await setupTestSandbox()
    } catch (error) {
      // wdio does not reliably abort the run when onPrepare rejects, which leaves workers
      // hanging against a missing sandbox. Report and hard-stop instead.
      process.stderr.write(
        `\n[e2e] Test sandbox setup failed; aborting run.\n${String(error)}\n`,
      )
      process.exit(1)
    }
  },
  onComplete: async () => {
    await teardownTestSandbox()
  },
  beforeSession: async (_config, _capabilities, specs, cid) => {
    const workerIndex = getWorkerIndexFromSpecs(specs)
    await setupWorkerSandbox(workerIndex)

    const workerHome = getWorkerHomePath(workerIndex)
    const workerBin = getWorkerRadicleBinPath(workerIndex)
    const pathWithoutSandboxBins = (process.env['PATH'] ?? '')
      .split(delimiter)
      .filter((segment) => segment !== radicleBinPath && segment !== workerBin)
      .join(delimiter)

    process.env['HOME'] = workerHome
    process.env['USERPROFILE'] = workerHome
    delete process.env['RAD_HOME']
    process.env['PATH'] = `${workerBin}${delimiter}${pathWithoutSandboxBins}`
    process.env['RAD_E2E_WORKER_ID'] = cid
    process.env['RAD_E2E_WORKER_INDEX'] = String(workerIndex)
    process.env['RAD_E2E_HOME'] = workerHome
    process.env['RAD_E2E_NODE_HOME'] = getWorkerNodeHomePath(workerIndex)
    process.env['RAD_E2E_WORKSPACE'] = getWorkerWorkspacePath(workerIndex)

    if (specs.some((spec) => spec.includes('onboarding.spec.ts'))) {
      await emulateRadCliUninstalled()
    }
  },
  afterSession: (_config, _capabilities, specs) => {
    teardownWorkerSandbox(getWorkerIndexFromSpecs(specs))
  },
}
