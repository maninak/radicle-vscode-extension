import type * as VsCode from 'vscode'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { arch, platform, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { browser } from '@wdio/globals'
import { $ } from 'zx'
import {
  emulatedHomePath,
  httpdHost,
  httpdPath,
  httpdVersion,
  nodeHomePath,
  nodePidFilePath,
  radCliPath,
  radCliVersion,
  radicleBinPath,
  testingWorkspacePath,
  wdioCachePath,
  wdioVideoPath,
  workerHomeNamePattern,
  workerWorkspaceNamePattern,
} from '../constants'
import {
  getWorkerHomePath,
  getWorkerHttpdPidFilePath,
  getWorkerNodeHomePath,
  getWorkerNodePidFilePath,
  getWorkerRadicleBinPath,
  getWorkerWorkspacePath,
} from './paths'

function resolveReleaseTargetTriple(): string {
  const osArch = `${platform()}/${arch()}`

  switch (osArch) {
    case 'darwin/arm64':
      return 'aarch64-apple-darwin'
    case 'darwin/x64':
      return 'x86_64-apple-darwin'
    case 'linux/arm64':
      return 'aarch64-unknown-linux-musl'
    case 'linux/x64':
      return 'x86_64-unknown-linux-musl'
    default:
      throw new Error(
        `Unsupported OS/arch for e2e tests: "${osArch}". ` +
          `Supported: macOS (arm64/x64) and Linux (arm64/x64).`,
      )
  }
}

function spawnDaemon(
  command: string,
  args: string[],
  { pidFilePath, logFilePath }: { pidFilePath: string; logFilePath: string },
): void {
  const logFd = fs.openSync(logFilePath, 'a')
  // `detached: true` + `child.unref()` lets the daemon outlive accidental parent
  // exits AND lets us signal its whole process group via a negative PID later.
  const child = spawn(command, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  })
  if (child.pid) {
    fs.writeFileSync(pidFilePath, String(child.pid))
  }
  child.unref()
}

/** Whether `pid` is a live process that was launched from inside the test sandbox. */
function isSandboxProcess(pid: number): boolean {
  try {
    // `ps -o args=` (POSIX) prints a process's command line. Our daemons were launched
    // from a binary inside emulatedHomePath, so a recycled or unrelated PID won't match.
    const commandLine = execFileSync('ps', ['-p', String(pid), '-o', 'args='], {
      encoding: 'utf-8',
    })

    return commandLine.includes(emulatedHomePath)
  } catch {
    return false
  }
}

function killByPidFile(pidFilePath: string): void {
  if (!fs.existsSync(pidFilePath)) {
    return
  }
  const pid = Number(fs.readFileSync(pidFilePath, 'utf-8').trim())
  // Only signal a PID we can confirm is still one of our sandbox daemons. A stale pidfile
  // (left by a crashed run) may reference a PID the OS has since recycled for an unrelated
  // process, and killing that process (or its whole group) could disrupt the user's machine.
  if (Number.isInteger(pid) && pid > 0 && isSandboxProcess(pid)) {
    // Negative PID targets the whole process group created via `detached: true`.
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, 'SIGTERM')
      } catch {
        /* already gone */
      }
    }
  }

  try {
    fs.rmSync(pidFilePath)
  } catch {
    /* ignore */
  }
}

/** Removes the disposable workspace folder that specs git- and rad-initialize. */
function resetTestingWorkspace(): void {
  fs.rmSync(testingWorkspacePath, { recursive: true, force: true })
}

async function assertPortIsFree(host: string, port: number): Promise<void> {
  await new Promise<void>((res, rej) => {
    const server = net
      .createServer()
      .once('error', (err: NodeJS.ErrnoException) =>
        rej(
          new Error(
            `Port ${host}:${port} is already in use (${err.code}). ` +
              `This is the extension's default httpd endpoint, so stop the process using it ` +
              `(e.g. a locally running radicle-httpd) before running the e2e suite.`,
          ),
        ),
      )
      .once('listening', () => server.close(() => res()))
    server.listen(port, host)
  })
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  { timeoutMs, label }: { timeoutMs: number; label: string },
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) {
      return
    }
    await sleep(500)
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`)
}

async function installRadCli(): Promise<void> {
  const target = resolveReleaseTargetTriple()
  const version = radCliVersion ?? 'latest'
  const url = `https://files.radicle.dev/releases/${version}/radicle-${target}.tar.xz`
  const tarballPath = join(emulatedHomePath, 'radicle.tar.xz')

  await $`curl -sSLf -o ${tarballPath} ${url}`
  // Extract the release tarball ourselves rather than piping radicle.dev/install to a shell:
  // that installer's unquoted `mkdir -p $PREFIX` corrupts paths containing spaces.
  await $`tar -xJf ${tarballPath} --strip-components=1 -C ${nodeHomePath}`
  await $`chmod -R +x ${radicleBinPath}`
  await $`rm -f ${tarballPath}`

  if (!fs.existsSync(radCliPath)) {
    throw new Error(`Radicle CLI was not installed at the expected path: ${radCliPath}`)
  }
}

async function installHttpd(): Promise<void> {
  const target = resolveReleaseTargetTriple()
  // The `latest` directory omits the version from the filename; versioned dirs include it.
  const isLatest = httpdVersion === 'latest'
  const fileName = isLatest
    ? `radicle-httpd-${target}.tar.xz`
    : `radicle-httpd-${httpdVersion}-${target}.tar.xz`
  const url = `https://files.radicle.dev/releases/radicle-httpd/${httpdVersion}/${fileName}`
  const tarballPath = join(emulatedHomePath, 'radicle-httpd.tar.xz')

  await $`curl -sSLf -o ${tarballPath} ${url}`
  // Extract into the node home (matching the CLI layout) so the binary lands at httpdPath.
  await $`tar -xJf ${tarballPath} --strip-components=1 -C ${nodeHomePath}`
  await $`chmod +x ${httpdPath}`
  await $`rm -f ${tarballPath}`

  if (!fs.existsSync(httpdPath)) {
    throw new Error(`httpd was not installed at the expected path: ${httpdPath}`)
  }
}

async function createRadicleIdentity(): Promise<void> {
  // RAD_PASSPHRASE='' (set in wdio.conf.ts) yields an unencrypted key, usable without an
  // ssh-agent.
  await $`rad auth --alias test_user`
}

/**
 * Configures the node for the isolated `test` network: no seeds, no peers, no TCP listener,
 * so it can neither reach nor be reached by the real network, nor clash with a node the
 * user may already run.
 */
function configureNodeForTesting(): void {
  const configPath = join(nodeHomePath, 'config.json')
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
    preferredSeeds?: unknown[]
    node?: Record<string, unknown>
  }

  config.preferredSeeds = []
  config.node = {
    ...config.node,
    network: 'test',
    connect: [],
    externalAddresses: [],
    listen: [],
    peers: { type: 'static' },
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

async function startSharedNode(): Promise<void> {
  // `--foreground` keeps the node attached to the child we spawn, so we can
  // SIGTERM it by PID even when `rad node stop` is unavailable (e.g. while the
  // Radicle CLI binary is moved aside for the "uninstalled" emulation).
  spawnDaemon(radCliPath, ['node', 'start', '--foreground'], {
    pidFilePath: nodePidFilePath,
    logFilePath: join(emulatedHomePath, 'radicle-node.log'),
  })
  await waitUntil(
    async () => {
      try {
        await $`rad node status`.timeout('5s')

        return true
      } catch {
        return false
      }
    },
    { timeoutMs: 30_000, label: 'the Radicle node to report running' },
  )
}

/** Idempotent, never throws. Safe to call from setup, signal handlers, and onComplete. */
export async function teardownTestSandbox(): Promise<void> {
  try {
    await $`rad node stop`.timeout('10s')
  } catch {
    /* ignore */
  }
  killByPidFile(nodePidFilePath)

  try {
    fs.rmSync(emulatedHomePath, { recursive: true, force: true })
  } catch {
    /* ignore */
  }

  try {
    for (const entry of fs.readdirSync(tmpdir())) {
      if (workerHomeNamePattern.test(entry) || workerWorkspaceNamePattern.test(entry)) {
        fs.rmSync(join(tmpdir(), entry), { recursive: true, force: true })
      }
    }
  } catch {
    /* ignore */
  }
  resetTestingWorkspace()
}

/**
 * Copies the shared sandbox identity (its `bin`, `config.json`, and keys, but not the running
 * node's runtime state) into a worker's own home, so each worker resolves its own isolated
 * Radicle CLI and identity. Mirrors the layout `rad` expects at `$HOME/.radicle`.
 */
export async function setupWorkerSandbox(workerIndex: number): Promise<void> {
  const workerNodeHome = getWorkerNodeHomePath(workerIndex)
  const workerKeysDir = join(workerNodeHome, 'keys')
  await $`mkdir -p ${workerKeysDir}`
  await $`cp -r ${join(nodeHomePath, 'bin')} ${join(workerNodeHome, 'bin')}`
  await $`cp ${join(nodeHomePath, 'config.json')} ${join(workerNodeHome, 'config.json')}`
  // `-p` preserves the secret key's permissions, which rad requires.
  await $`cp -p ${join(nodeHomePath, 'keys', 'radicle')} ${join(nodeHomePath, 'keys', 'radicle.pub')} ${workerKeysDir}`
  await $`mkdir -p ${getWorkerWorkspacePath(workerIndex)}`
}

/** Removes a worker's home and workspace. Idempotent, never throws. */
export function teardownWorkerSandbox(workerIndex: number): void {
  fs.rmSync(getWorkerHomePath(workerIndex), { recursive: true, force: true })
  fs.rmSync(getWorkerWorkspacePath(workerIndex), { recursive: true, force: true })
}

/**
 * Starts a Radicle node dedicated to one worker, so a network-mutating spec can mutate
 * Radicle state without touching the shared, read-only node. The worker home and its
 * isolated `test`-network config were already provisioned by `setupWorkerSandbox`. Pair
 * every call with `stopWorkerNodeAndHttpd`.
 */
export async function startWorkerNode(workerIndex: number): Promise<void> {
  const workerHome = getWorkerHomePath(workerIndex)
  const radCli = join(getWorkerRadicleBinPath(workerIndex), 'rad')

  spawnDaemon(radCli, ['node', 'start', '--foreground'], {
    pidFilePath: getWorkerNodePidFilePath(workerIndex),
    logFilePath: join(workerHome, 'radicle-node.log'),
  })
  await waitUntil(
    async () => {
      try {
        await $`rad node status`.timeout('5s')

        return true
      } catch {
        return false
      }
    },
    { timeoutMs: 30_000, label: `worker ${workerIndex}'s Radicle node to report running` },
  )
}

/**
 * Starts a Radicle node + httpd dedicated to one worker, on its own httpd port, for specs
 * that additionally exercise the Radicle HTTP API (e.g. clone's repo browsing).
 */
export async function startWorkerNodeAndHttpd(
  workerIndex: number,
  httpApiPort: number,
): Promise<void> {
  const workerHome = getWorkerHomePath(workerIndex)
  const httpd = join(getWorkerRadicleBinPath(workerIndex), 'radicle-httpd')

  await startWorkerNode(workerIndex)

  await assertPortIsFree(httpdHost, httpApiPort)
  spawnDaemon(httpd, ['--listen', `${httpdHost}:${httpApiPort}`], {
    pidFilePath: getWorkerHttpdPidFilePath(workerIndex),
    logFilePath: join(workerHome, 'radicle-httpd.log'),
  })
  await waitUntil(
    async () =>
      await new Promise<boolean>((res) => {
        const socket = net
          .connect({ host: httpdHost, port: httpApiPort })
          .once('connect', () => {
            socket.destroy()
            res(true)
          })
          .once('error', () => {
            socket.destroy()
            res(false)
          })
      }),
    {
      timeoutMs: 30_000,
      label: `worker ${workerIndex}'s httpd to listen on ${httpdHost}:${httpApiPort}`,
    },
  )
}

/**
 * Stops a worker's node + httpd. Idempotent, never throws. `killByPidFile` confirms each PID
 * still is one of our sandbox daemons before signalling; a worker home path starts with
 * `emulatedHomePath`, so that confirmation matches a worker daemon's command line too.
 */
export function stopWorkerNodeAndHttpd(workerIndex: number): void {
  killByPidFile(getWorkerNodePidFilePath(workerIndex))
  killByPidFile(getWorkerHttpdPidFilePath(workerIndex))
}

/**
 * Creates a git repo in the worker's home and `rad init`s it as a public repo, so the worker's
 * httpd serves it from `/repos` and the extension can clone it. Returns the new repo's RID.
 * The worker's node must already be running (see `startWorkerNodeAndHttpd`).
 */
export function seedPublicRepo(
  workerIndex: number,
  { name, description }: { name: string; description: string },
): string {
  const repoDir = join(getWorkerHomePath(workerIndex), 'seed-repo')
  const radCli = join(getWorkerRadicleBinPath(workerIndex), 'rad')
  fs.mkdirSync(repoDir, { recursive: true })

  function runGit(args: string[]): void {
    execFileSync('git', args, { cwd: repoDir, stdio: 'ignore' })
  }
  runGit(['init', '-b', 'main', '.'])
  runGit(['config', 'user.email', 'e2e@radicle.test'])
  runGit(['config', 'user.name', 'Radicle E2E'])
  fs.writeFileSync(join(repoDir, 'README.md'), `# ${name}\n`)
  runGit(['add', '.'])
  runGit(['commit', '-m', 'adds readme', '--no-gpg-sign'])

  execFileSync(
    radCli,
    [
      'init',
      '--public',
      '--default-branch',
      'main',
      '--name',
      name,
      '--description',
      description,
      '--no-confirm',
    ],
    { cwd: repoDir, stdio: 'ignore' },
  )
  const rid = execFileSync(radCli, ['inspect', '--rid'], {
    cwd: repoDir,
    encoding: 'utf-8',
  }).trim()
  if (!rid.startsWith('rad:')) {
    throw new Error(
      `Failed to seed a public repo for worker ${workerIndex}; got rid "${rid}".`,
    )
  }

  return rid
}

/**
 * Provisions the test sandbox, clearing any leftover state from a previous run first. On
 * failure, cleans up and rethrows so no partial sandbox is left behind.
 */
export async function setupTestSandbox(): Promise<void> {
  try {
    await teardownTestSandbox()
    await $`mkdir -p ${wdioCachePath}`
    await $`mkdir -p ${wdioVideoPath}`
    await $`mkdir -p ${nodeHomePath}`
    await $`mkdir -p ${testingWorkspacePath}`
    await installRadCli()
    await installHttpd()
    await createRadicleIdentity()
    configureNodeForTesting()
    await startSharedNode()
  } catch (error) {
    await teardownTestSandbox()
    throw error
  }
}

const radCliUninstalledStub =
  '#!/bin/sh\n# e2e test stub: emulates an unresolvable Radicle CLI by failing with no output.\nexit 1\n'

/** Resolves the calling worker's own Radicle CLI paths from the per-worker env. */
function getWorkerRadCliPaths(): { radCli: string; backup: string } {
  const workerNodeHome = process.env['RAD_E2E_NODE_HOME']
  if (!workerNodeHome) {
    throw new Error('RAD_E2E_NODE_HOME is unset; the per-worker sandbox env was not injected.')
  }
  const radCli = join(workerNodeHome, 'bin', 'rad')

  return { radCli, backup: `${radCli}.uninstalled` }
}

/**
 * Makes the Radicle CLI appear unresolvable to the extension, emulating a "not installed"
 * state. Call `emulateRadCliInstalled` to restore.
 */
export async function emulateRadCliUninstalled(): Promise<void> {
  const { radCli, backup } = getWorkerRadCliPaths()
  // A stub that resolves-but-fails (rather than a missing binary) is needed: otherwise the
  // extension's `which rad` lookup would find a real `rad` elsewhere on the user's PATH.
  await $`mv ${radCli} ${backup}`
  fs.writeFileSync(radCli, radCliUninstalledStub, { mode: 0o755 })
}

/** Restores the Radicle CLI after a call to `emulateRadCliUninstalled`. */
export async function emulateRadCliInstalled(): Promise<void> {
  const { radCli, backup } = getWorkerRadCliPaths()
  fs.rmSync(radCli, { force: true })
  await $`mv ${backup} ${radCli}`
}

/**
 * To be run once per session before any spec. Throws if the extension host's `HOME` or
 * `PATH` do not reflect the test sandbox, aborting the run before any spec can touch
 * real Radicle state.
 */
export async function assertExtensionResolvedTestSandbox(): Promise<void> {
  const extHostEnv = await browser.executeWorkbench(() => ({
    home: process.env['HOME'],
    userProfile: process.env['USERPROFILE'],
    radHome: process.env['RAD_HOME'],
    path: process.env['PATH'],
    workerId: process.env['RAD_E2E_WORKER_ID'],
  }))

  if (!extHostEnv.workerId) {
    throw new Error(
      'Extension host did not inherit RAD_E2E_WORKER_ID set in `beforeSession`, so per-worker ' +
        'env does not reach the launched VS Code. Per-worker sandbox isolation depends on it.',
    )
  }

  const workerHome = process.env['RAD_E2E_HOME']
  const workerNodeHome = process.env['RAD_E2E_NODE_HOME']
  const workerBin = workerNodeHome ? join(workerNodeHome, 'bin') : undefined

  const resolvedHome = extHostEnv.home ?? extHostEnv.userProfile
  if (!resolvedHome || !workerHome || !resolve(resolvedHome).startsWith(resolve(workerHome))) {
    throw new Error(
      `Extension host HOME ("${resolvedHome ?? 'unset'}") is not this worker's emulated home ` +
        `("${workerHome ?? 'unset'}"). Aborting to avoid touching the real Radicle home.`,
    )
  }
  if (extHostEnv.radHome) {
    throw new Error(
      `Extension host has RAD_HOME set ("${extHostEnv.radHome}"); it must be unset so the ` +
        `default $HOME/.radicle path is exercised.`,
    )
  }
  if (!workerBin || !extHostEnv.path?.split(delimiter).includes(workerBin)) {
    throw new Error(
      `Extension host PATH does not contain this worker's bin dir ("${workerBin ?? 'unset'}"); ` +
        `\`which rad\` would not resolve to the emulated Radicle CLI. Aborting.`,
    )
  }

  const openedWorkspace = await browser.executeWorkbench(
    (vscode: typeof VsCode) => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  )
  const workerWorkspace = process.env['RAD_E2E_WORKSPACE']
  if (
    !openedWorkspace ||
    !workerWorkspace ||
    resolve(openedWorkspace) !== resolve(workerWorkspace)
  ) {
    throw new Error(
      `Extension host opened workspace ("${openedWorkspace ?? 'none'}") is not this worker's ` +
        `workspace ("${workerWorkspace ?? 'unset'}"). Parallel workers must each open their own.`,
    )
  }
}
