import type { XOR } from 'ts-xor'
import {
  execFileSync,
  type ExecFileSyncOptionsWithStringEncoding,
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from 'node:child_process'
import { useEnvStore } from '../stores'
import { getWorkspaceFolderPaths, log, truncateKeepWords } from '../utils'
import { getConfig } from './config'

interface ExecOptions {
  /** List of string arguments for the given command. */
  args?: string[]
  /**
   * Whether to log the command output to the Output panel. If `false` and an error occurs, the
   * error is still logged to the Debug console (only visible during development). Defaults to
   * `false`.
   */
  shouldLog?: boolean
  /**
   * Maximum time in ms before the command is forcefully terminated. Set to `0` to disable.
   * Defaults to `30_000`.
   */
  timeout?: number
  /**
   * If `true`, leading and trailing whitespace is stripped from stdout before it is returned.
   * Defaults to `true`.
   */
  outputTrimming?: boolean
  /**
   * Working directory for the command. Pass `'$workspaceDir'` to use the VS Code workspace
   * folder. Defaults to `undefined`.
   */
  cwd?: (string & {}) | '$workspaceDir'
  /** Additional environment variables to merge into the child process env. */
  env?: SpawnSyncOptionsWithStringEncoding['env']
}

/**
 * Executes a shell command and returns the stdout of the command, if it was successful.
 *
 * @example
 * ```ts
 * exec('echo "hello shell :)"')
 * //> hello shell :)
 * ```
 *
 * @param cmd - The shell command to execute. Can be a static string or a function resolving
 * the command dynamically.
 * @param options - Optional configuration; see `ExecOptions`.
 * @returns The output of the shell command if successful, otherwise `undefined`.
 */
export function exec(cmd: string | (() => string), options?: ExecOptions): string | undefined {
  const opts = options ?? {}
  const resolvedCmd = typeof cmd === 'function' ? cmd() : cmd

  try {
    let cwd: string | undefined
    if (opts.cwd === '$workspaceDir') {
      const firstWorkspaceDir = getWorkspaceFolderPaths()?.[0] // Hack: always use only 0th folder
      if (!firstWorkspaceDir) {
        throw new Error(
          `Failed resolving path of workspace directory in order to exec "${resolvedCmd}" in it`,
        )
      }
      cwd = firstWorkspaceDir
    } else {
      cwd = opts.cwd
    }

    const spawnOpts: SpawnSyncOptionsWithStringEncoding = {
      shell: true,
      cwd,
      timeout: opts.timeout ?? 30_000,
      encoding: 'utf-8',
      env: { ...process.env, ...opts.env },
    }

    const execResult = spawnSync(resolvedCmd, (opts.args ?? []).map(maybeEscapeArg), spawnOpts)
    if (execResult.error || execResult.status) {
      throw execResult.error ?? (execResult.stderr || execResult.stdout)
    }

    const parsedResult =
      (opts.outputTrimming ?? true) ? execResult.stdout.trim() : execResult.stdout
    if (opts.shouldLog ?? false) {
      log(
        parsedResult,
        'info',
        `${resolvedCmd} ${options?.args ? options.args.map(maybeEscapeArg).join(' ') : ''}`,
      )
    }

    return parsedResult
  } catch (error) {
    const fullCmd = `${resolvedCmd} ${
      options?.args ? options.args.map(maybeEscapeArg).join(' ') : ''
    }`
    const parsedError = parseError(error, resolvedCmd)

    if (opts.shouldLog ?? false) {
      log((opts.outputTrimming ?? true) ? parsedError.trim() : parsedError, 'error', fullCmd)
    }

    // will show up only in the Debug console during development
    console.error(fullCmd)

    return undefined
  }
}

interface ExecGitOptions {
  /** Whether to log the command output to the Output panel. Defaults to `false`. */
  shouldLog?: boolean
  /**
   * Maximum time in ms before the command is forcefully terminated. Set to `0` to disable.
   * Defaults to `30_000`.
   */
  timeout?: number
  /** Working directory for the command. Defaults to `undefined`. */
  cwd?: string
  /**
   * If `true`, leading and trailing whitespace is stripped from stdout before it is returned.
   * Defaults to `true`.
   */
  outputTrimming?: boolean
}

/**
 * Executes commands using the `git` binary directly, without spawning a shell.
 *
 * Unlike `exec()` there is no shell doing arg splitting, so paths with spaces and
 * special characters are safe across platforms, including Windows.
 *
 * @param args - Arguments passed to the `git` binary. Special shell characters don't need
 * escaping and there is no risk of shell injection.
 * @param options - Optional configuration; see `ExecGitOptions`.
 * @returns An object with either the `stdout` of the command if successful, or the `errorCode`
 * that Node.js or git returned, along with any `stderr` and `stdout` outputs.
 */
export function execGit(
  args: string[],
  options?: ExecGitOptions,
): XOR<{ stdout: string }, { errorCode: string | number; stdout?: string; stderr?: string }> {
  const opts = options ?? {}
  const truncatedGitCmd = `git ${args
    .map((arg) => maybeEscapeArg(truncateKeepWords(arg, 60, ' […]')))
    .join(' ')}`

  try {
    const spawnOpts: ExecFileSyncOptionsWithStringEncoding = {
      shell: false,
      cwd: opts.cwd,
      timeout: opts.timeout ?? 30_000,
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024,
      env: process.env,
    }

    const stdout = execFileSync('git', args, spawnOpts)
    const parsedStdout = (opts.outputTrimming ?? true) ? stdout.trim() : stdout
    if (opts.shouldLog ?? false) {
      log(parsedStdout, 'info', truncatedGitCmd)
    }

    return { stdout: parsedStdout }
  } catch (err) {
    const error = err as Error & {
      status: number // should be non-zero as per the process-return-value convention
      code?: string // set if spawning child process failed: e.g. 'ENOENT', 'ETIMEDOUT'
      stdout?: string
      stderr?: string
    }

    console.error(truncatedGitCmd, '\n\n', error)
    if (opts.shouldLog ?? false) {
      log(
        error.stderr?.trim() ||
          error.message.trim() ||
          `Failed executing command: ${truncatedGitCmd}`,
        'error',
        truncatedGitCmd,
      )
    }

    return {
      stdout: error.stdout,
      stderr: error.stderr?.trim(),
      errorCode: error.code || error.status,
    }
  }
}

interface ExecRadOptions {
  /**
   * Whether to log the command output to the Output panel. If `false` and an error occurs, the
   * error is still logged to the Debug console (only visible during development). Defaults to
   * `false`.
   */
  shouldLog?: boolean
  /**
   * Maximum time in ms before the command is forcefully terminated. Set to `0` to disable.
   * Defaults to `30_000`.
   */
  timeout?: number
  /**
   * Working directory for the command. Pass `'$workspaceDir'` to use the VS Code workspace
   * folder. Defaults to `undefined`.
   */
  cwd?: (string & {}) | '$workspaceDir'
  /** Additional environment variables to merge into the child process env. */
  env?: ExecFileSyncOptionsWithStringEncoding['env']
  /**
   * Whether to re-run the command when it fails, e.g. to ride out a transient sqlite
   * "database is locked" while the node persists a concurrent write. `true` uses sensible
   * defaults; pass an object to tune. Defaults to no retries.
   */
  retryOnFailure?: boolean | { retries: number; intervalMs: number }
}

type ExecRadResult = XOR<
  { stdout: string },
  { errorCode: string | number; stdout?: string; stderr?: string }
>

const defaultRetry = { retries: 6, intervalMs: 400 } as const

/**
 * Executes commands using the `rad` CLI binary directly, without spawning a shell, optionally
 * retrying on failure (see `options.retryOnFailure`).
 *
 * @example
 * ```ts
 * const { stdout: alias } = execRad(['self', '--alias'])
 * // Equivalent to running `rad self --alias` in the shell, but without using a shell
 * ```
 *
 * @param args - Arguments passed to the `rad` binary. Special shell characters don't need
 * escaping and there is no risk of shell injection.
 * @param options - Optional configuration; see `ExecRadOptions`.
 * @returns An object with either the `stdout` of the command if successful, or the `errorCode`
 * that Node.js or the rad binary returned, along with any `stderr` and `stdout` outputs.
 */
export function execRad(args: string[] = [], options?: ExecRadOptions): ExecRadResult {
  const { retries, intervalMs } =
    options?.retryOnFailure === true
      ? defaultRetry
      : options?.retryOnFailure || { retries: 0, intervalMs: 0 }

  let result = execRadOnce(args, options)
  for (let attempt = 0; result.errorCode !== undefined && attempt < retries; attempt++) {
    sleepSync(intervalMs)
    result = execRadOnce(args, options)
  }

  return result
}

/**
 * Blocks the current thread for `ms` without spinning the CPU. `execRad` is synchronous by
 * contract (it wraps `execFileSync`), so its retry backoff is synchronous too.
 */
function sleepSync(ms: number): void {
  if (ms > 0) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  }
}

function execRadOnce(args: string[] = [], options?: ExecRadOptions): ExecRadResult {
  const opts = options ?? {}

  const truncatedRadCmd = `rad ${args
    .map((arg) => maybeEscapeArg(truncateKeepWords(arg, 40, ' […]')))
    .join(' ')}`

  try {
    let cwd: string | undefined
    if (opts.cwd === '$workspaceDir') {
      const firstWorkspaceDir = getWorkspaceFolderPaths()?.[0] // Hack: always use only 0th folder
      if (!firstWorkspaceDir) {
        throw new Error(
          `Failed resolving path of workspace directory in order to exec "${truncatedRadCmd}" in it`,
        )
      }
      cwd = firstWorkspaceDir
    } else {
      cwd = opts.cwd
    }

    const configPathToNodeHome = getConfig('radicle.advanced.pathToNodeHome')
    const spawnOpts: ExecFileSyncOptionsWithStringEncoding = {
      shell: false,
      cwd,
      timeout: opts.timeout ?? 30_000,
      encoding: 'utf-8',
      // `rad cob show` for a whole repo's patches can emit several MB; the default 1MB would
      // overflow with an ENOBUFS error, surfacing as a spurious "Failed listing patches".
      maxBuffer: 100 * 1024 * 1024,
      env: {
        ...process.env,
        ...(configPathToNodeHome ? { RAD_HOME: configPathToNodeHome } : {}),
        ...opts.env,
      },
    }

    const stdout = execFileSync(
      useEnvStore().resolvedAbsolutePathToRadBinary,
      args,
      spawnOpts,
    ).trim()
    if (opts.shouldLog ?? false) {
      log(stdout, 'info', truncatedRadCmd)
    }

    return { stdout }
  } catch (err) {
    const error = err as Error & {
      status: number // should be non-zero as per the process-return-value convention
      code?: string // set if spawning child process failed: e.g. 'ENOENT', 'ETIMEDOUT'
      stdout?: string
      stderr?: string
    }

    console.error(truncatedRadCmd, '\n\n', error)
    if (opts.shouldLog ?? false) {
      log(
        error.stdout?.trim() ||
          error.message.trim() ||
          error.stderr?.trim() ||
          `Failed executing command: ${truncatedRadCmd}`,
        'error',
        truncatedRadCmd,
      )
    }

    // will show up only in the Debug console during development
    return {
      stdout: error.stdout?.trim(),
      stderr: error.stderr?.trim(),
      errorCode: error.code || error.status,
    }
  }
}

function parseError(error: unknown, resolvedCmd: string): string {
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }

  return `Failed executing shell command: "${resolvedCmd}"`
}

function maybeEscapeArg(cliArg: string): string {
  const arg = cliArg
  /**
   * @see https://stackoverflow.com/questions/15783701/which-characters-need-to-be-escaped-when-using-bash/20053121#20053121
   */
  const maybeEscapedArg =
    arg.includes("'") || arg.includes(' ') ? `'${arg.replace(/'/g, "'\\''")}'` : arg

  return maybeEscapedArg
}
