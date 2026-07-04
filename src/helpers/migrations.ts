import { tmpdir } from 'node:os'
import { sep } from 'node:path'
import { ConfigurationTarget, workspace } from 'vscode'
import { log } from '../utils'

/**
 * Removes the now-obsolete `search.exclude` entry that older extension versions (up to v0.6.2)
 * wrote to the user's global settings to hide the temporary patch-diff files from search. Those
 * temp files are gone (patch diffs are now served from an in-memory virtual filesystem), so the
 * exclusion only lingers as dead config pollution in every existing user's settings.
 *
 * Idempotent: a no-op once the entry is absent, so it is safe to run on every activation.
 *
 * TODO: maninak remove this one-time migration around 2027-01 (~6 months after v0.7), by when
 * upgraded users will have had it run at least once.
 */
export function pruneObsoleteTempFilesSearchExclude(): void {
  const obsoleteExcludeGlob = `${tmpdir()}${sep}radicle${sep}**`
  const searchExcludeKey = 'search.exclude'

  const config = workspace.getConfiguration()
  const globalSearchExclude =
    config.inspect<Record<string, unknown>>(searchExcludeKey)?.globalValue
  if (!globalSearchExclude || !(obsoleteExcludeGlob in globalSearchExclude)) {
    return
  }

  const { [obsoleteExcludeGlob]: _removed, ...remainingSearchExclude } = globalSearchExclude
  void config
    .update(searchExcludeKey, remainingSearchExclude, ConfigurationTarget.Global)
    .then(
      () => log(`Pruned obsolete "${obsoleteExcludeGlob}" from "${searchExcludeKey}"`, 'info'),
      (reason: unknown) =>
        log(
          `Failed pruning obsolete "${obsoleteExcludeGlob}" from "${searchExcludeKey}"`,
          'warn',
          String(reason),
        ),
    )
}
