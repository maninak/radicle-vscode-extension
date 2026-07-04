import type { getConfig } from '../helpers'
import { commands, workspace } from 'vscode'

/**
 * Opens the Settings UI with the options filtered to show only the specified config
 *
 * POST-CONDITIONS:
 * - The correct scope, `User` or `Workspace`, will be automatically selected based on
 * which is actually being evaluated as the effective one.
 */
export function openSettingsFocusedAtConfig(config: Parameters<typeof getConfig>['0']): void {
  const configDetails = workspace.getConfiguration().inspect(config)

  commands.executeCommand(
    `workbench.action.open${configDetails?.workspaceValue ? 'Workspace' : ''}Settings`,
    config,
  )
}
