import { FetchError } from 'ofetch'
import { window } from 'vscode'
import { fetchFromHttpd } from '../helpers'
import { log, showLog } from '../utils'
import { openSettingsFocusedAtConfig } from './settings'

const unknownApiErrorMarker = 'EUNKONWNSERVICENAME'

/**
 * Will check if connection to a Radicle API endpoint can be established, log either way,
 * and depending on the `minimizeUserNotifications` optional param, may notify the user of
 * the result.
 *
 * @returns `true` if connection could be established, otherwise `false`.
 */
export async function validateHttpdConnection(
  options: { minimizeUserNotifications: boolean } = { minimizeUserNotifications: false },
): Promise<boolean> {
  const { data: root, response, error } = await fetchFromHttpd('/')
  if (!root) {
    if (options.minimizeUserNotifications) {
      log(
        'Radicle HTTP API is unreachable. It is optional: patch data is sourced from the ' +
          'local Radicle node.',
        'info',
      )
    } else {
      notifyUserAboutFetchError(error)
    }

    return false
  } else if (root.service !== 'radicle-httpd') {
    const errorMsg = `${unknownApiErrorMarker} The HTTP API at "${response.url}" doesn't seem \
      to be a known Radicle API. \
      Please ensure that the url configured in the extension's settings is pointing to \
      the root endpoint advertised when spawning the "radicle-httpd" service.`
    log(errorMsg, 'error', `Fetching "${response.url}"...`)
    !options.minimizeUserNotifications && notifyUserAboutFetchError(new FetchError(errorMsg))

    return false
  }

  const msg = `Connected with Radicle HTTP API v${root.version} at "${response.url}"`
  log(msg, 'info')
  !options.minimizeUserNotifications && window.showInformationMessage(msg)

  return true
}

/**
 * Notifies the user with an error based on the kind of error encountered during
 * a network request, and provides them with follow-up options,
 * e.g. to open the extension's settings or show the logs.
 *
 * @param error The error that was thrown when the recuest to httpd failed.
 */
// TODO: revisit all cases because the errors seem to have changed (due to Fetch v2?) and
// most/all cases seem to not match anymore
export async function notifyUserAboutFetchError(error: FetchError): Promise<void> {
  const requestUrl = error?.request?.toString()
  const buttonOutput = 'Show Output'
  const buttonSettings = 'Review Setting'
  let userSelection: typeof buttonOutput | typeof buttonSettings | undefined

  if (error?.message.includes('ECONNREFUSED')) {
    userSelection = await window.showErrorMessage(
      `Failed establishing connection with Radicle HTTP API at "${requestUrl}". \
      Please ensure that \`radicle-httpd\` is already running, that it is accessible from \
      your network and that the address to the API's root endpoint is correctly set \
      in the extension's settings.`,
      buttonSettings,
      buttonOutput,
    )
  } else if (error.message.includes(unknownApiErrorMarker)) {
    userSelection = await window.showErrorMessage(
      error.message.replace(unknownApiErrorMarker, ''),
      buttonSettings,
    )
  } else if (error?.statusCode === 404) {
    userSelection = await window.showErrorMessage(
      `Failed establishing connection with Radicle HTTP API at "${requestUrl}". \
      Please ensure that the address to the API's root endpoint is correctly set \
      in the extension's settings.`,
      buttonSettings,
      buttonOutput,
    )
  } else {
    userSelection = await window.showErrorMessage(
      `Failed sending network request to Radicle HTTP API at "${requestUrl}".`,
      buttonSettings,
      buttonOutput,
    )
  }

  if (userSelection === 'Show Output') {
    showLog()
  } else if (userSelection === 'Review Setting') {
    openSettingsFocusedAtConfig('radicle.advanced.httpApiEndpoint')
  }
}
