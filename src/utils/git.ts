import { exec } from '../helpers'

/**
 * Returns `true` if the opened workspace folder is an initialized git repo, otherwise `false`.
 */
export function isGitRepo(): boolean {
  const isInitialized = Boolean(
    exec('git rev-parse --is-inside-work-tree', { cwd: '$workspaceDir' }),
  )

  return isInitialized
}

/**
 * Resolves the root directory of the git repo of the opened workspace folder.
 */
// TODO: maninak memoize
export function getRepoRoot(): string | undefined {
  const gitRepoRootDir = exec('git rev-parse --show-toplevel', { cwd: '$workspaceDir' })

  return gitRepoRootDir
}

/**
 * Resolves the current branch's name and its upstream branch (if any) with a single git
 * invocation, if in a Git repository.
 *
 * @example
 * ```ts
 * getCurrentGitBranchAndUpstream() // { branch: 'feat/75_fix-pesky-bug', upstream: 'rad/patches/abc123' }
 * ```
 */
export function getCurrentGitBranchAndUpstream():
  | { branch: string; upstream: string | undefined }
  | undefined {
  const nameAndUpstream = exec('git rev-parse --abbrev-ref --symbolic-full-name @ @{u} --', {
    cwd: '$workspaceDir',
  })
  if (nameAndUpstream) {
    const [branch, upstream] = nameAndUpstream.split('\n')

    return branch ? { branch, upstream } : undefined
  }

  // the single-call form errors whenever no upstream is configured, so re-resolve just the name
  const branch = exec('git rev-parse --abbrev-ref HEAD', { cwd: '$workspaceDir' })

  return branch ? { branch, upstream: undefined } : undefined
}
