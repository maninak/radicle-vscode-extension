import type * as VsCode from 'vscode'
import type { Workbench } from 'wdio-vscode-service'
import { join } from 'node:path'
import { browser, expect } from '@wdio/globals'
import { $, cd } from 'zx'
import { openRadicleViewContainer } from '../helpers/actions'
import {
  areStringArraysEqual,
  expectStandardSidebarViewsToBeVisible,
} from '../helpers/assertions'
import { getFirstWelcomeViewButtonTitles, getFirstWelcomeViewText } from '../helpers/queries'
import {
  assertExtensionResolvedTestSandbox,
  emulateRadCliInstalled,
} from '../helpers/testSandbox'

describe('Onboarding Flow', () => {
  let workbench: Workbench

  before(async () => {
    workbench = await browser.getWorkbench()
    await assertExtensionResolvedTestSandbox()
  })

  describe('VS Code, *before* Radicle is installed,', () => {
    it('has our Radicle extension installed and available', async () => {
      const extensions = await browser.executeWorkbench(
        (vscode: typeof VsCode) => vscode.extensions.all,
      )

      expect(
        extensions.some((extension) => extension.id === 'radicle-ide-plugins-team.radicle'),
      ).toBe(true)
    })

    it('shows the Radicle button in the Activity Bar', async () => {
      const radicleViewControl = await workbench.getActivityBar().getViewControl('Radicle')
      const title = await radicleViewControl?.getTitle()

      expect(title).toBe('Radicle')
    })

    it('instructs the user to install radicle', async () => {
      await openRadicleViewContainer(workbench)

      await browser.waitUntil(async () => {
        const welcomeText = await getFirstWelcomeViewText(workbench)
        const buttonTitles = await getFirstWelcomeViewButtonTitles(workbench)

        return (
          areStringArraysEqual(welcomeText, [
            'Failed resolving the Radicle CLI binary.',
            "Please ensure it is installed on your machine and either that it is globally accessible in the shell as `rad` or that its path is correctly defined in the extension's settings.",
            "Please expect the extention's capabilities to remain severely limited until this issue is resolved.",
          ]) && areStringArraysEqual(buttonTitles, ['Troubleshoot'])
        )
      })
    })
  })

  describe('Radicle, *before* the open directory is git-initialized,', () => {
    before(async () => {
      await emulateRadCliInstalled()
    })

    it('guides the user on how to git-initialize their workspace', async () => {
      await openRadicleViewContainer(workbench)

      await browser.waitUntil(async () => {
        const welcomeText = await getFirstWelcomeViewText(workbench)
        const welcomeButtonTitles = await getFirstWelcomeViewButtonTitles(workbench)

        return (
          areStringArraysEqual(welcomeText, [
            'The folder currently opened in your workspace is not a Git code repository.',
            'In order to use Radicle with it, this folder must first be initialized as a Git code repository.',
            'To learn more about how to use Git and source control in VS Code read the docs.',
          ]) &&
          areStringArraysEqual(welcomeButtonTitles, [
            'Initialize Repository With Git',
            'Choose a Different Folder',
          ])
        )
      })
    })
  })

  describe('Radicle, *before* the open repository is rad-initialized,', () => {
    before(async () => {
      await initGitRepo()
    })

    it('guides the user on how to rad-initialize their git repo', async () => {
      await openRadicleViewContainer(workbench)

      await browser.waitUntil(async () => {
        const welcomeText = await getFirstWelcomeViewText(workbench)

        return areStringArraysEqual(welcomeText, [
          'The Git repository currently opened in your workspace is not yet initialized with Radicle.',
          'To use Radicle with it, please run `rad init` in your terminal.',
          'Once rad-initialized, this repo will have access to advanced source control, collaboration and project management capabilities powered by both Git and Radicle.',
          'During this reversible rad-initializing process you also get to choose whether your repo will be private or public, among other options.',
          'To learn more read the Radicle User Guide.',
        ])
      })
    })
  })

  describe('Radicle, *after* the open repository is rad-initialized,', () => {
    before(async () => {
      await $`rad init --private --default-branch master --name "Repo" --description "Test repo" --no-confirm --verbose`
    })

    it('hides the non rad-initialized guide', async () => {
      await browser.waitUntil(async () => {
        const welcomeText = await getFirstWelcomeViewText(workbench)

        return welcomeText.some((text) => text.includes('rad init')) === false
      })
    })

    it('shows the standard sidebar views', async () => {
      await expectStandardSidebarViewsToBeVisible(workbench)
    })
  })

  // Regression for #172: Node's file watchers can't fire for a path whose parent dir didn't
  // exist when we started watching (e.g. rad installed _after_ the extension loaded), so the
  // extension falls back to polling. Point it at a binary under a not-yet-existing dir, then
  // create the binary there and assert it gets picked up with no window reload.
  describe('Radicle CLI appearing at a path that did not exist when the extension loaded,', () => {
    const nodeHome = process.env['RAD_E2E_NODE_HOME'] ?? ''
    const realRadCli = join(nodeHome, 'bin', 'rad')
    const lateBinDir = join(nodeHome, 'late-bin')
    const lateRadCli = join(lateBinDir, 'rad')

    before(async () => {
      await setPathToRadBinaryConfig(lateRadCli)
    })

    after(async () => {
      await setPathToRadBinaryConfig(undefined)
      await $`rm -rf ${lateBinDir}`
    })

    it('reports the CLI as unresolvable while the configured path is still missing', async () => {
      await openRadicleViewContainer(workbench)

      await browser.waitUntil(
        async () =>
          (await getFirstWelcomeViewText(workbench)).some((text) =>
            text.includes('Failed resolving the Radicle CLI binary'),
          ),
        {
          timeoutMsg:
            'expected the "CLI unresolvable" guide while the configured path is missing',
        },
      )
    })

    it('picks up the CLI once it appears there, with no reload (via the fallback poll)', async () => {
      await $`mkdir -p ${lateBinDir}`
      await $`cp ${realRadCli} ${lateRadCli}`
      await $`chmod +x ${lateRadCli}`

      // the poll re-checks every few seconds, so allow comfortably more than one interval
      await browser.waitUntil(
        async () =>
          (await getFirstWelcomeViewText(workbench)).some((text) =>
            text.includes('Failed resolving the Radicle CLI binary'),
          ) === false,
        {
          timeout: 20_000,
          timeoutMsg:
            'expected the extension to pick up the newly-created rad binary via its poll',
        },
      )
    })
  })
})

async function setPathToRadBinaryConfig(path: string | undefined): Promise<void> {
  await browser.executeWorkbench(
    async (vscode: typeof VsCode, configuredPath: string | undefined) => {
      await vscode.workspace
        .getConfiguration()
        .update(
          'radicle.advanced.pathToRadBinary',
          configuredPath,
          vscode.ConfigurationTarget.Global,
        )
    },
    path,
  )
}

async function initGitRepo() {
  const workspacePath = process.env['RAD_E2E_WORKSPACE'] ?? ''
  await $`mkdir -p ${workspacePath}`
  cd(workspacePath)
  await $`git init -b master .`
  await $`git config --local user.email "test@radicle.dev"`
  await $`git config --local user.name "Radicle Test"`
  await $`echo "# Basic Repo" > README.md`
  await $`git add README.md`
  await $`git commit -m 'adds readme' --no-gpg-sign`
}
