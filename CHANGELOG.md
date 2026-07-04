# Radicle VS Code Extension Change Log

## **Unreleased**

### ✨ Highlights

🆓 from httpd!

### 🚀 Enhancements

- **httpd:** remove the need for httpd. Radicle Patches now work fully offline, without needing `radicle-httpd` to be installed or running. All patch data (listings, details, file diffs) is sourced directly from the local Radicle node using the `rad` CLI and git. The HTTP API remains supported as an optional, alternative source of network state for upcoming features.
- **aliases:** keep showing node aliases (for patch authors, reviewers, etc.), previously sourced by httpd. This is done using an OS-agnostic WASM sqlite reader, not with a native module, to retain multi-OS support, including for Windows and no per-distro releases. It accesses the local node's address book sqlite database, and stores them in a vscode-native, machine-local cache for instant rendering on next launch.
- **commands:**  list every known repo from any seed ever configured when cloning a repo, not just the ones already present in the local Radicle storage. The list is sourced from the configured HTTP API endpoint and loads instantly from a machine-local cache (offline included), with a background refresh at most once a day that shows a spinner while fetching and grows the offered list live as results arrive. The full list is cached on disk while the most widely-seeded repos are the ones offered, so the picker stays manageable as the network grows.
- **patches:** show the diff of a patch's changed files from in-memory virtual documents served straight out of the local Radicle storage, instead of writing temporary files to disk. Diff editors are now inherently read-only, nothing pollutes the OS temp dir or search results, and (unlike files on disk) their content can never go stale. Binary files such as images are served byte-accurate, so VS Code renders them properly in the diff (e.g. an image preview) instead of as corrupted text ([#154](https://github.com/maninak/radicle-vscode-extension/issues/154))

### 🩹 Fixes

- **patches:** show the checked-out marker on a patch checked out from outside VS Code (e.g. via `rad patch checkout` in a terminal). The upstream tracking that identifies the checked-out patch is configured after the branch has already switched, which the extension previously missed
- **patches:** clear the previously checked-out patch's marker immediately when checking out another patch, instead of leaving a stale second marker behind
- **httpd:** correctly parse multi-digit major versions of the Radicle HTTP API (e.g. `10.x`) when adapting requests for older APIs
- **settings:** remove the obsolete `radicle.hideTempFiles` setting and, for users who had it enabled, automatically prune the stale `search.exclude` entry it had written to global settings, now that patch diffs are served from an in-memory virtual filesystem and no longer write temporary files to disk

### ☑️ Tests

- **patches:** cover the patches' general features with e2e tests. Listing in the sidebar, opening the Patch Detail webview, refreshing after out-of-band `rad` edits, and editing a patch's status, title and description from within the webview, all asserted across the sidebar, the webview and the `rad` CLI's own view of the resulting state.
- **patches:** cover patch state synchronization with e2e tests: git-checking-out via a terminal being reflected in the list and webview, checking out the patch or the default branch from the webview and the list (including with non-conflicting and conflicting dirty working directories), and out-of-band revisions re-sorting the list without duplicating entries
- **patches:** cover listing a patch's changed files and opening a diff editor with e2e tests
- **aliases:** cover node-alias resolution with unit tests (address-book cache seeding, refresh-and-persist, and mapping a patch author to its alias) and an e2e assertion that a patch author renders its alias, sourced from the local node's address book, instead of a node id
- **clone:** cover the cloneable-repo cache and picker with unit tests (version-adaptive pagination, the once-a-day refresh throttle, the full-on-disk vs capped-in-memory split, live list growth, and offline error handling) and rework the clone e2e for the new live-updating picker
- **e2e:** silence the git and `rad` command output that the test runner echoed during patch setup, de-noising the e2e logs (failures still surface their output)
- **onboarding:** cover, with an e2e test, that the extension picks up a rad binary created at a path whose parent directory did not exist when the extension loaded, without a window reload (via the fallback poll)

### 📖 Documentation

- **readme:** remove all references to httpd

---

## **v0.6.2** (June 20th, 2026)

### 🩹 Fixes

- **markdown:** restore rendering of patch titles, descriptions, and comments. A recent Vite upgrade broke markdown rendering because it is incompatible with the old UMD module format used by `vue3-markdown-it`, which is no longer maintained.
- **config:** support resolving and validating the Radicle CLI binary on Windows. `pathToRadBinary` now accepts Windows drive-letter paths such as `C:\Users\me\.cargo\bin\rad.exe` (forward slashes work too), instead of flagging them as invalid and refusing a real `rad.exe`. Aliased resolution uses `where` on Windows in place of the POSIX-only `which`, and keeps the first match when several copies of `rad` are on `PATH`, so a `rad.exe` already available in the shell is recognized

### ☑️ Tests

- **markdown:** add regression tests ensuring markdown rendering in webviews remains fixed
- **config:** cover the `pathToRadBinary` validation pattern with unit tests

### ❤️ Code Contributors

- justarandomgeek (`did:key:z6Mkum88mKcX2sARx8R18RZUmAdakPFbXtdHzn8JNVEDqkxj`)

---

## **v0.6.1** (June 19th, 2026)

### ✨ Highlights

 This is primarily a maintenance release. It resolves serious technical debt arising partially from the maintenance gap which resulted in dependency rot. Moreover it brings a powerful, new, fully end-to-end testing infrastructure, a new unit testing infrastructure and tests for them as well as a drastically overhauled local development loop.

All of the above establish a solid foundation for future development and a more comfortable and reassuring environment for current and new contributors.

### 🩹 Fixes

- **commands:** fix `radicle.clone` [needlessly](https://app.radicle.xyz/nodes/seed.radicle.garden/rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5/patches/897efc90af30a24856dc81c0bd2539bf32a3385f) requiring authentication
- **commands:** fix `radicle.clone` outright not doing anything when selecting a repo to clone
- **commands:** fix items listed in `radicle.clone`'s' list missing repo title and description missing title and description
- **commands:** fix `radicle.clone` placing the checkout in a way untrue to git's, where the chosen folder was treated as a parent and the cloned repo got silently nested in a subfolder under it. The user's directory selection now mirrors git's behaviour, and the post-clone "open" reliably opens the expected folder
- **config:** re-point the file watchers when `pathToRadBinary` or `pathToNodeHome` changes, and keep polling for a CLI binary or identity at the configured location, so one placed there after the setting was set is recognized too, instead of the extension silently keeping its old state until the next window reload
- **config:** correctly report the resolved Radicle identity when `pathToNodeHome` points at a home that holds no identity (or whose identity has not been created yet). Previously the extension could either misreport the Radicle CLI as not installed or surface the CLI's error output as if it were a valid identity, rather than reporting that no identity is stored there

### 🏡 Chores

- **dev:** overhaul the local development inner loop. Webview changes now hot-reload in place via the Vite dev server, while extension host changes rebuild and reload the host window automatically. No more closing and relaunching the host window on every change and waiting for a >10s build + launch after each CSS change. The dev watchers also persist and get reused across debug sessions, so re-launching with F5 after closing the host VS Code window is instant; no building. This also means that the previous zombie process issues resulting in memory & CPU hogging, eventual laptop thermal throttling and battery draining are finally gone too.
- **dev:** extension's esbuild errors will be detected by the `dev` Task runner which in turn will automatically switch to the associated terminal panel, auto-revealing the runner's tab and marking its title text in red and with an X next to it
- **lint:** migrate the extension and its webviews to [`@maninak/eslint-config`](https://npmjs.com/package/@maninak/eslint-config), a single-install suite bundling linting rules and formatting for TS, Vue, JSON, YAML, Markdown and more. Allows dropping the bespoke >400-line config and numerous associated dependencies we had, while bringing in new and improved capabilities. Critically, both the extension and webviews workspaces are now linted with an identical and powerful ruleset.
- **lint:** fix broken IDE inline-with-code linting, formatting and auto-fix-on-save for the extension workspace
- **lint:** enable IDE inline linting for the (nested) webviews workspace together with the existing one for the root extension workspace (finally!)
- **lint:** wire `lint-staged` to actually run on `git commit` (previously the configured hook re-linted the whole repo on every commit instead of just staged files), leverage caching when linting changes, and ensure git hooks remain installed with a `postinstall` script
- **dev:** replace deprecated guard used to ensure only pnpm is used for dependency management, effectively also fixing the broken dev script issue. New contributors can now again enjoy the zero-step experience of just opening the repo in VS Code after a fresh git-clone and hitting F5 to start developing
- **build:** increase transpilation target to es2022 (latest supported by VS Code)
- **dev:** migrate to Node.js v24, pnpm v11
- **ts:** migrate extension and webviews to TypeScript v6, modernize tsconfigs, detangle inheritance and clean-up interdependent configs
- **deps:** increase minimum VS Code version requirement to v1.112.0
- **deps:** upgrade all extension and webview dependencies resolving all deprecation warnings and addressing all security alerts

### 🤖 CI

- **e2e:** implement a workflow to test in CI
- **ci:** cache node_modules, including the large fetched chromium drivers for subsequent e2e runs
- **ci:** update all workflows and their actions to use at least Node.js v24

### ☑️ Tests

- **e2e:** set up new infrastructure capable of automated completely end-to-end testing. It uses the official script to install a real Radicle node, powering the latest extension build, which is running in an actual VS Code. The test runner can manipulate VS Code as a real user would and can assert behavior and state even as deep as extension webviews.
- **e2e:** support running the tests locally too, beyond just on CI. Without the option to use containerization given the rendering and OS constraints, a bespoke e2e harness was architected in such a way that a maintainer's existing Radicle installation and storage would remain unaffected and protected while emulating the necessary environment for the testing fixtures (where we un-/install radicle, rad-initialize repos, create patches, etc). More info in the [e2e Readme](./test/e2e/README.md).
- **onboarding:** cover various paths of the flow with e2e tests
- **e2e:** support multiple isolated test suits running concurrently, each with their own `RAD_HOME`, `rad`, storage, `httpd`, etc
- **e2e:** support testing in both Linux and MacOS environments
- **e2e:** take photos and videos of failed test runs and, when on CI, upload them to artifacts
- **settings:** cover the extension's advanced settings with e2e tests: resolving the Radicle CLI from `pathToRadBinary`, the identity from `pathToNodeHome` (including each being created at the configured location after the fact), and the HTTP API connection from `httpApiEndpoint`
- **unit:** set up new infrastructure for unit testing the extension's logic
- **commands:** cover `radicle.clone` with unit tests
- **commands:** cover `radicle.clone` flow with e2e tests

### 📖 Documentation

- **repo:** repair all broken links and miscellaneous references to now moved radicle.xyz and app.radicle.xyz

---

## **v0.6.0** (November 9th, 2024)

### ✨ Highlights

- create new comments on patches
- preview your patch edits and draft new comments, before submitting them, with Markdown support
- polished, comfortable authoring experience

### 🚀 Enhancements

- **patch-detail:** add a new "Comment" button next to the revision selector
  - clicking the button shows a new patch-comment form in the top of the Activity section
    - the form consists of
      - a text-field where the user can type their comment
      - the target revision under which the comment is to be created
      - form control buttons
    - if in single-column mode due to narrow viewport the active tab automatically switches to the Activity section
    - form state is preserved (as described in [v0.5.0#enhancements](#v050-july-22nd-2024)) individually for each revision
  - clicking the form's "Comment" button or the keyboard shortcut `Ctrl/Cmd + Enter` submits the form
    - attempts to create a new comment on radicle under the selected revision
    - informs the user of the action's result (created and announced / created only locally / failed) and offers follow-up actions as needed
    - upon the comment's successful creation, it is shown directly in place of the patch-comment form as a new event at the top of the Activity section with the time-ago indicator showing "now" and a short "pulse-outline" animation around it
- **patch-detail:** in the patch-edit form
  - show placeholder text when either text-field is empty
  - change button label "Save" to "Update"
- **patch-detail:** in both patch-comment and patch-edit forms
  - add a new button with a coffee icon between "Update"/"Comment" and "Discard"
    - clicking it "pauses" editing, hiding the form but preserving the current changes for later (a.k.a. aforementioned form state preservation)
    - also triggerable with keyboard shortcut `Escape`
    - also acts as a safe "spacer" between the two aforementioned buttons protecting against misclicks that would otherwise come with a big penalty
  - add a new button to toggle a markdown preview of the current changes before submitting
    - also triggerable with keyboard shortcut `Alt + P`
    - after toggling to markdown preview and back to editing the undo/redo history (Ctrl/Cmd + Z and Ctrl/Cmd + Shift + Z) is still available. Even if the form contains multiple controls (e.g. two text-areas) then the undo/redo history spanning _all of them in the order they were changed_ is still retained
  - polish text-field sizing dynamics:
    - use 1 line of text as starting height when empty for the patch title field and 4 lines for the patch description
    - respectively limit the max vertical lines for the former and the latter
    - fields offer 65 characters of horizontal space (when there's enough viewport width, whatever fits otherwise), which also happens to be the Markdown renderer's wrapping limit (with exceptions). This can double as a subtle hint that we may be typing too much. Longer lines of text widen the fields to fit the content as long as there's enough viewport space, at which point they'll wrap into a new line, line-breaking at at appropriate point.
    - previously typing or focusing any of the form's fields would always scroll the viewport to align the form at its bottom. Now this happens only if the form doesn't already fit on the viewport, leaving the scroll position wherever it was already set by the user and resulting in a less constricting experience
    - although fields remain manually user-resizeable (pursposefully only across height) by mouse-dragging the bottom-right handle of each field _and_ dynamically resizeable as content grows (with contextual restrictions) and shrinks, if the user indeed defines a preferred height using the former method, then it is respected by the latter
  - the aforementioned coupled with the pre-existing feature of optimally auto-aligning the form as it resizes should seamlessly provide a smooth authoring experience
  - adjust the hover text of all form buttons to advertise their respective keyboard shortcut (if any)
  - **patch-detail:** preselect the merged revision, if any, in the revision selector instead of always the latest
  - **patch-detail:** don't mention the revision and its identifier in events in the Activity section if there's only one revision
  - **patch-detail:** align the UX for every revision identifier shown in the patch-major-events section (top of the view) with the behaviour of those in the Activity section, i.e. showing the revision description on hover, and when clicked scrolling to the Revision section wherin more info about it is shown
  - **patch-detail:** don't mention the related commit in the patch-major-events section (~~"Last updated by W with revision X at commit Y Z time ago"~~). This information is still available in the Revision section.
  - **patch-detail:** keep the labels of the main buttons (top-right of the view) as a single line of text, even if the viewport is narrow enough to compress them
  - **patch-detail:** add themed styling to `<summary>` elements when tabbed into

### 🩹 Fixes

- **patch-detail:** don't disappear the Activity and Revision sections sometimes, e.g. when a new revision is detected
- **patch-detail:** make "Refresh" button work again, fetching latest patch data
- **patch-detail:** don't show big gap between patch title and next section if the patch description is empty

### 🏡 Chores

- **ts:** enforce stricter type-checking for webview apps
- **deps:** upgrade webview app dependencies, including latest Vue v3.5

## **v0.5.1** (September 10th, 2024)

### 🩹 Fixes

- **httpd:** Addresses regression caused due to a breaking changes in Radicle HTTP API daemon (`radicle-httpd`) `v0.16.0` and `v0.17.0`

### 📖 Documentation

- **readme:** add badge advertising that we're co-publishing in Open VSX and the count of downloads in that registry
- **readme:** use cached queries to shields.io to reduce the chance of of hitting the API query limits

---

## **v0.5.0** (July 22nd, 2024)

### ✨ Highlights

- first mutations are here! (patch title, description and status)
- reactive state shared between extension and webviews
- significant hardening and polishing of existing features and their UX
- security and performance improvements
- research and groundwork for future operation without requiring Radicle HTTP API Daemon a.k.a. `httpd`

### 🚀 Enhancements

- **patch-detail:** support mutating patch titles and descriptions
  - a new "Edit" button has been added next to the title, shown when hovering on the title or description. Clicking it will show two text-areas, one for each of the aforementioned, and additional buttons
  - the Edit button:
    - is only available if the local identity is the author of the patch or among the repository's delegates
    - is able to be tabbed into with the keyboard, which will make it visible again, despite it being conditionally hidden (accessibility)
    - gets thinner on narrower viewports to allow maximum space for the already constricted title
  - while editing the following buttons are shown:
    - "Save" updates the changed title to Radicle
    - "Discard" stops the editing mode and discards the values currently entered in the text-area as well as the preserved drafts, if any (see below the functionality of Escape key)
    - their tabbing order (tabbing into them past the text-areas) is set so that "Save" is first, as expected in a form, despite them being right-aligned
  - the text-area:
    - supports any text content, including markdown and any special or uncommon characters
    - gets keyboard focus automatically when the edit button is clicked
    - auto-expands and auto-shrinks vertically to optimally fit its content, up to a viewport-relative maximum. Applies on focus and while typing.
    - keeps the viewport pinned at an optimal and stable scroll position regardless of how the text-area resizes
    - can be manually resized by dragging its bottom-right corner, but only vertically to keep the interaction less chaotic
    - has maximum and minimum height defined, after which internal scrolling of the contents is enabled
    - responds to viewport size changes applying sizing limits on top of the aforementioned content-relative resizing
    - is set with (generous) max char count limits to limit abuse
    - pressing the Enter key enters a new line but pressing Ctrl/Cmd+Enter behaves as if the "Save" button was clicked
  - the value of each text-area is preserved as an in-extension draft while typing, as well as the "is editing" status of the form, and those will be attempted to be restored:
    - if the editor panel is hidden (another panel is selected placing it in the background) and then re-viewed (same session)
    - if VS Code is terminated or crashes (across sessions)
    - if the form submission fails
  - if Escape key is pressed editing stops. The current changes get stored as a draft that will be reused if editing is restarted during the same VS Code usage session
  - clicking "Save" executes a rad CLI command updating both the title and description from the form after trimming any leading and trailing whitespace
  - if the user is not authed when clicking "Save", the Authentication Flow is launched interstitially, upon the successful completion of which the patch edit command will follow
  - busy/progress indicator is shown in the Patches view while the patch-update command is executing
  - depending on the outcome of the patch edit command the user is presented with
    - an info notification that the patch was updated and the changes announced over the network. Those changes also immediately propagate across all UI elements of the extension and its webviews.
    - a warning notification that the patch was updated but only locally without the changes reaching the network. The user is offered the options to "Retry Announce" or "Show Output".
    - an error notification that the update failed altogether. The user is offered the option to "Show Output" and if the error was due to a timeout (either nodejs or rad CLI-based) they are also offered to "Retry With Longer Timeout".
      - if "Retry With Longer Timeout" is clicked, the patch edit command will be retried with a two minute timeout
      - each time a rad operation is launched with a timeout longer than 30s then its busy indicator is instead shown in the [Status Bar](https://code.visualstudio.com/docs/getstarted/userinterface), not the Patches view
      - each time the retried command with longer time-out also times out, then the user is again presented the "Retry With Longer Timeout" which will quadruple the previous timeout (e.g. 2, 8, 24 minutes etc)
- **webview:** make webviews like the one for patch details reactively adapt their UI state when any extension state they depend on is updated
- **patch-list:** support changing a patch's status via new context-menu (right-click) actions "Change Patch Status to Draft[or Open/Archived]" on non-merged patch items
  - only shown if the user is authorized to perform the actions
  - only those actions applicable given the patch's status are shown
- **patch-detail:** support changing a patch's status via a new button "Edit"
  - shown on hover or on keyboard-focus of the patch status badge. The button replaces the badge in place, with visual cues assisting the transition.
  - only shown if the user is authorized to perform the actions
  - clicking the Edit button toggles the visibility of status-selection radio buttons and becomes "Close" while they are visible
  - selecting a status from the available radios will immediately trigger a patch status change. The handling of this command supports the rich UX also described above for the title and description change.
  - keyboard focus is preserved on the button after pressing "clicking" it with the keyboard, even though there are four different elements conditionally layered on top of each other, including two separate buttons
  - this bespoke Edit toggle button(s) still behaves like the standard one e.g. showing a focus ring but only when focused with the keyboard remaining accessible *and* visually lean
- **patch-detail:** replace generic file icon in webview panel with one that depicts the patch status
- **patch-detail:** replace former "Reveal" button with a new "Browse Diff" one that still reveals the patch among others in the list but additionally expands it to show the changed files and moves the keyboard focus over to that item
- **patch-detail:** the former "Check Out Default" button now has a dynamic copy "Check Out $nameOfdefaultBranch"
- **patch-detail:** add a button next to a revision's latest and base commit identifier which copies the full id to clipboard
- **commands:** use the name of the tracked upstream branch of the currently checked out branch, instead of just the latter, when trying to detect if a radicle patch is currently checked out
- **commands:** improve the algorithm detecting if patch/default branch check-out failed due to uncommitted changes in the working directory.
  - additionally, if there was a check-out error and that was the reason, then offer, additionally to the default option of seeing the command's output, the option to switch to the native Source Control View where the user can take inspect further and take follow-up actions
  - if there was a check-out error due to a different reason, the error notification copy is more generic without suggesting to the user to "commit or stash changes" and without showing the button "Focus Source Control View"
- **exec:** invoke Radicle CLI binary directly for rad commands without spawning a shell
  - increased robustness by negating the extension's exposure to OS/shell-specific edge cases
  - lays much of the groundwork for the upcoming independence of the extension from the Radicle HTTP daemon for local operations
- **onboarding:** multiple improvements on the getting-started flow:
  - better clarify *required* next steps on each Welcome View
  - better clarify that the existing init button will perform `git init` (not `rad init`)
  - better inform and reassure the user about `rad init` when offering it to them
  - offer a link to the Radicle User Guide for further info
  - misc copy alignments between Welcome Views
- **onboarding:** multiple improvements on the cli-troubleshooting flow:
  - for the option with external link to install Radicle, it will now take the user directly to the "get-started" section of the Radicle website
  - suggest the modern `~/.radicle/bin/rad` vs the legacy ~~/usr/bin/rad~~ as a path to the CLI binary in the placeholder of the input for a custom path to CLI
  - general copy improvements across all branches of the flow
- **settings:** disallow usage of now unsupported relative paths for config `radicle.advanced.pathToRadBinary`
- **settings:** support trailing slashes for config `radicle.advanced.pathToNodeHome`
- **patch-list:** show all possible actions for a patch on its context menu (right click)
- **patch-list:** add new context-menu action "Refresh Patch Data" for a patch item

### 🔥 Performance

- **exec:** invoke Radicle CLI binary directly for rad commands without spawning a shell to remove a 20-40ms overhead on rad commands which results in all-around speed-up of the extension including its activation time
- **patch-list:** speed up (re-)loading of Patches view by caching env state previously resolved anew for each patch item in the list
  - measured as ~25% faster for a real-world Project with >350 patches

### 🛡️ Security Fixes

- **exec:** sanitize untrusted paths and other values before interpolating them into shell commands or forgo spawning a shell altogether, greatly decreasing the extension's exposure to potential shell injection attacks

### 🩹 Fixes

- **store:** fix a couple dozens interconnected (:sigh:) state syncronization bugs between the Patch-Detail view and the Patches view that each would occur only following very specific reproduction steps
- **webview:** make webview restoration, for example switching back to the panel hosting it after switching away from it in a way that would put it to the background, *signigicantly* more robust and much less likely to result in an blank panel
- **webview:** keep panel's title in sync with the title of the patch shown within it as it gets updated either from the extension user or from network users
- **patch-detail:** the buttons on Patch-Detail webviews left open from a previous VS Code session that got restored will now work, same as those of just opened webviews
- **patch-list:** more accurately reflect git check-out state per patch in the list. Previously a checked out patch would not have the associated checkmark denoting its state shown in the patch list unless a check out AND a list refresh was done. Some edge cases may remain unpatched still.
- **patch-list:** sort changed file entries placing correctly always to the top those located at the root directory of the repo
- **patch-list:** let the "Updated X time ago" text in the title bar of the Patches view be updated when there's only one patch in the currently open repo and the user refetched its data exclusively, e.g. using the "Refresh" button in the Patch-Detail view
- **commands:** don't fail checking out patch branch if the branch already existed but was referring to a different revision than the one we're attempting to check out
- **settings:** watch *user-defined* path to Radicle CLI binary for changes too. Previously only the default paths per OS were being watched.
- **onboarding:** don't show simultaneously cli-troubleshooting and getting-started Welcome Views when the rad CLI isn't installed
- **onboarding:** detect Radicle CLI binary installation change even if file or parent directory tree is missing on extension's initialization
- **markdown:** polish (un-)ordered/task lists. Align identation, fix unordered list to start with bullet and generally and define styles for nested lists, including mixed ol and ul.
- **markdown:** align horizontal rule with text column instead of it being always in the middle
- **markdown:** ensure the language tag on (recognised) code blocks is still shown after re-rendering them
- **markdown:** make the language tag on (recognised) code blocks not user-selectable
- **patch-detail:** homogenize all tooltips and controls to have their copy in Title Case
- **log:** show the actual output of failed rad commands (which explains _why_ it failed...) instead of sometimes showing the CLI's progress-spinnner characters spammed en masse
- **patch-list:** show all patches again as expected, not only those with status "open". Addresses regression caused due to a breaking change in Radicle HTTP API (httpd) while keeping backwards compatibility for users who haven't yet upgraded to the latest httpd
- **auth:** use the term "seal" instead of "lock" in commands and logs, e.g. "unsealed identity" instead of "unlocked identity", which better aligns with the CLI terminology and communicates facts slightly more accurately

### 💅 Refactors

- **webview:** restructure architecture for better type-safety, easier maintenance and make the logic independent of the specific single webview available for now
- **commands:** replace the deprecated term "project" with "repository" in the title of `radicle.clone` and `radicle.checkoutDefaultBranch`

### 🏡 Chores

- **store:** further progress on migrating formerly imperative state management to a declarative, reactive paradigm. See Chores of [v0.4.0](#v040-feb-28th-2024) for more info.
- **dev:** don't pause awaiting user approval to temporarily install pnpm when verifying deps installation
- **dev:** always use the latest pnpm version when verifying deps installation
- **deps:** upgrade to the latest version of codicons
- **log:** always log errors in the debug console too (during development), in addition to the Output panel
- **deps:** bump minimum VS Code version requirement from 1.84.2 to 1.91.0

### 📖 Documentation

- **contributing:** add new "Copywriting" section under "Conventions" with the directives followed when writing user-facing copy for this repo
- **readme:** show correct RID of the Radicle VS Code repo in the rad badge

---

## **v0.4.1** (May 1st, 2024)

### 🚀 Enhancements

- **settings:** add config to toggle excluding temporary files created by the extension, e.g. those used to produce the diff of a patch's changed files, from the list of recently opened files. This is enabled by default. This currently works only partly, but should automatically be fully working when [the underlying VS Code bug](https://github.com/microsoft/vscode/issues/157395#issuecomment-2080293320) is fixed and released (ETA beginning of May). ([#94](https://github.com/cytechmobile/radicle-vscode-extension/issues/94))
- **commands:** show (apropriate kind per case of) busy/progress indicators when the extension is busy executing a long-running task, which especially when initiated by the user, would otherwise leave them confused as to what the state of the execution is (non-initiated, initiated, succesful, failed). ([#134](https://github.com/cytechmobile/radicle-vscode-extension/issues/134))
  Specifically:
  - "sync", "fetch" and "announce" commands (launched either via buttons or the Command Palette) show an inditerminate busy indicator on the "CLI COMMANDS" View as well as on the Radicle icon of the Activity bar
  - "rad clone" command indicates on the Status Bar whether the extension is fetching the list of cloneable repos or later in the flow actively performing the cloning
  **commands:** increase "rad clone" timeout to 120 seconds and add explicit success and failure logs ([#134](https://github.com/cytechmobile/radicle-vscode-extension/issues/134))
- **patch-list:** show diff for copied and moved files of a patch too when available ([#100](https://github.com/cytechmobile/radicle-vscode-extension/issues/100))
- **patch-list:** show path to containing directory for each changed file of a patch ([#100](https://github.com/cytechmobile/radicle-vscode-extension/issues/100))
- **patch-list:** increase count of maximum fetched patches per status to 500 ([#100](https://github.com/cytechmobile/radicle-vscode-extension/issues/100))
- **patch-detail:** improve how reactions are shown ([#103](https://github.com/cytechmobile/radicle-vscode-extension/issues/103))
  - use more subtle styling when a reaction involves the local radicle identity (italic text vs border & background)
  - show "you" instead of local identity's alias
  - on hover show the truncated DId next to each identity
- **patch-detail:** show all datestime strings in localized format according to the user's specified preference along the stack starting from the OS configuration (e.g. `LC_TIME`) until that of VS Code, in that oder of preference (e.g. with "de-AT" "Fr., 26. Apr. 2024, 10:00 MEZ" vs ~~"Fri, Apr 26, 2024, 10:00 AM Serbia Time"~~) ([#116](https://github.com/cytechmobile/radicle-vscode-extension/issues/116))
- **patch-detail:** show zero-timezone-offset ISO datetimes instead of using Zulu notation which is easier for human brains to parse (e.g. "2024-04-30T15:40:17.661+00:00" vs ~~"2024-04-30T15:40:17.661Z"~~) ([#116](https://github.com/cytechmobile/radicle-vscode-extension/issues/116))

### 🔥 Performance

- **patch-list:** speed-up overall list rendering and reduce perf impact when it includes patches with high counts of changed files ([#100](https://github.com/cytechmobile/radicle-vscode-extension/issues/100))

### 🩹 Fixes

- **patch-detail:** restore showing reactions to comments and revisions. Addresses regression caused due to a breaking change in Radicle HTTP API (httpd) ([#103](https://github.com/cytechmobile/radicle-vscode-extension/issues/103))
- **patch-detail:** correctly show the review author in Activity and Revision sections. Previously the revision author was erroneously shown. ([#110](https://github.com/cytechmobile/radicle-vscode-extension/pull/110))
- **patch-list:** don't throw error when expanding patch item. Addresses breaking change in the httpd response schema. ([#109](https://github.com/cytechmobile/radicle-vscode-extension/pull/109))
- **auth:** address multiple UX issues with the auth request flow  ([#115](https://github.com/cytechmobile/radicle-vscode-extension/issues/115))
  - use warning kind of notification instead of error when attempting to perform an auth-guarded command, since the user is also offered the option to launch the auth flow
  - improve copy of notification requesting auth for guarded commands
  - add missing log entry when the user dismisses the authentication request
- **commands:** address multiple UX issues with rad clone ([#115](https://github.com/cytechmobile/radicle-vscode-extension/issues/115))
  - require authentication before running command (align with CLI's behaviour)
  - don't explain erroneously that RID means Radicle ID
  - replace the term "project" with "repo" in user notifications
  - remove duplicate word on successful clone notification

### 🏡 Chores

- **deps:** reduce minimum VS Code version requirement from 1.86.0 to 1.84.2 to allow the extension to auto-upgrade for most users, including those using the (outdated) stable nix repository. The latest extension version is often (as is the case for this version) necessary for compatibility with the latest Radicle CLI version. We currently don't depend on latest version APIs either. ([#136](https://github.com/cytechmobile/radicle-vscode-extension/issues/136))
- **scripts:** parallelize verifying extension and webview dependencies ([#108](https://github.com/cytechmobile/radicle-vscode-extension/pull/8), [#111](https://github.com/cytechmobile/radicle-vscode-extension/pull/111))
- **dev:** configure "Develop Extension" launch configuration to show the stack trace in case of nodejs deprecation warning, helping pinpoint the root cause ([#132](https://github.com/cytechmobile/radicle-vscode-extension/issues/132))

### 🤖 CI

- **ci:** upgrade actions to their latest versions which are migrated from nodejs v16 to v20 ([#111](https://github.com/cytechmobile/radicle-vscode-extension/pull/111))

### 📖 Documentation

- update readme links and marketplace metadata to point to Radicle instead of GitHub ([#113](https://github.com/cytechmobile/radicle-vscode-extension/pull/113))
- **readme:** add badges showcasing current published version, installation count & repository identifier (RID) of the extension ([#113](https://github.com/cytechmobile/radicle-vscode-extension/pull/113))
- **contributing:** suggest `rad clone` instead of git clone from GitHub ([#113](https://github.com/cytechmobile/radicle-vscode-extension/pull/113))
- **contributing:** major improvement with new sections referencing zulip, creating a Radicle Issue and more ([#122](https://github.com/cytechmobile/radicle-vscode-extension/issues/122))

### ❤️ Code Contributors

- Lorenz Leutgeb (`lorenz`, `did:key:z6MkkPvBfjP4bQmco5Dm7UGsX2ruDBieEHi8n9DVJWX5sTEz`)

---

## **v0.4.0** (Feb 28th, 2024)

### ✨ Highlights

- New Patch detail view

    ![Patche detail view](./assets/for-md/patch-detail.png)

### 🚀 Enhancements

- **patch-detail:** implement new patch detail webview showing highly dynamic, in-depth information for a specific patch
  - can be opened via a new button "View Patch Details" on each item in the Patches view
  - panel's title shows the patch description in full if it's short, otherwise truncated to the nearest full word fitting the limit
  - the new view's design is purposefully minimal, glanceable, legible, responsive and verbose. It remains familiar to VS Code's native look'n'feel, while also staying true to Radicle's "hacky" vibe. Despite it being a full-fledged custom web-app under the hood, it successfully creates the illusion of it being just another piece of native VS Code UI.
  - view's theme adapts fully and on-the-fly (without reopening of the view) to whichever theme the user configures for his VS Code
  - view has the following main sections:
    - header
    - Patch
    - Revision
    - Activity
  - header section shows the following info:
    - status of the patch (e.g. open, merged, archived, ...)
      - the status badge's background color is a dynamic color mix of the patch status color and the dynamic editor-foreground color inherited from vscode's current theme so as to ensure text contrast reaching at least [WCAAG AA](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Understanding_WCAG/Perceivable/Color_contrast) level of accessibility at all times while also retaining a relative consistency of the colors across all our UIs and user-selected themes
    - major events like "created", "last updated", "merged" and related info with logic crafting optimal copy for each case (see similar tooltip improvements below)
    - a "Refresh" button that refetches from httpd all data of that patch and updating all views that depend on it
    - a "Check Out" button that checks out the Git branch associated with the Radicle patch shown in the view
      - shown only if the patch is not checked out
    - a "Check Out Default" button that checks out the Git branch marked as default for the Radicle project
      - shown only if the patch is checked out
    - "time-ago" for major patch events gets auto-updated to remain accurate as time goes by
  - Patch section shows the following info:
    - checked-out indicator
      - not shown if the Git branch associated with this Radicle patch is not currently checked out
    - id
      - has on-hover button to copy patch identifier to clipboard
    - revision author(s)
    - labels
      - not shown if empty
    - emoji reactions to the patch
      - if the total count of reactions is 4 or less, then the reacting users' alias/truncated-Nid are shown next to each reaction
      - if the total count of reactions is 5 or more, then the count of users with the same reaction are shown next to each reaction
      - shows, on hover, the Radicle identities behind each reaction in list-ified english copy
      - if the _local_ Radicle identity is included in the reacting users, the reaction gets an additional visual cue
      - if a Radicle identity has already interacted in any other form in the patch, the identity's alias (if available) will be resolved and shown. Otherwise the identity's middle-truncated Nid (Node Identifier) will be shown (author alias is otherwise unavailable in the reaction entity).
    - title
      - supports markdown
    - description
      - supports markdown
  - Revision section shows the following info:
    - a revision selection dropdown located next to the section heading contains all revisions of the current patch as options
      - if a revision is merged it is auto-selected, otherwise it will be the most recently created
      - revisions are sorted as most-recent-top
      - revisions can be quickly browsed by using the up/down buttons while the dropdown is focused
      - revisions can be quickly searched by typing the beginning of a revision id while the dropdown is focused
      - revision are dynamically formatted so that the list can be scannable for a quick overview, while also showing only whatever info is necessary in each scenario, with the following data
        - shortened revision id
        - "mini"-sized "time-ago"
        - state
          - `merged`
            - suffixed with `/<countOfMergedRevisions>` if more than one revisions got merged e.g. `merged/3`
            - not shown if revision isn't merged
          - `accepted`
            - not shown if the revision doesn't have an `accept` review
          - `rejected`
            - not shown if the revision doesn't have a `reject` review
          - `first`
            - not shown if the revision isn't the earliest one for this patch or if it has only one revision
          - `latest`
            - not shown if the revision isn't the most recent one for this patch or if it has only one revision
          - `sole`
            - not shown if there are more than one revisions
          - not shown if empty
        - author
          - not shown if all revisions are from the same author
      - as the viewport is getting narrower the dropdown will respond by also becoming narrower to always fit within the webview. But when clicked to expand its popover listing the available revision options for selection, those options will always be shown in full, adjusting the scroll state as needed and restoring it when the popover is closed.
    - id
      - has on-hover button to copy revision identifier to clipboard
    - author
    - reviews
      - shows list of Radicle identity aliases who "accepted" and/or "rejected" the selected revision
      - not shown if empty
    - date
      - the full date the selected revision was created, in local timezone
      - shows the full date in standard ISO 8601 format
    - latest commit
      - the head commit of the selected revision
    - based on commit
      - the commit the selected revision is branched off of
    - emoji reactions to the revision
      - same behaviour as described for patch section
    - description
      - supports markdown
      - if the selected revision is the first revision, the description is hidden under an expand-on-click control (to avoid showing the same content twice since it's already shown in the Patch section)
      - not shown if empty
  - Activity section lists various patch-related events that took place across the lifetime of the patch. Each event is preceded by a "mini"-sized "time-ago" and a dedicated icon. A new event entry is listed for:
    - event for patch revision creation
      - if the patch and its first revision have the same id, the copy explicitly points that out, organically also educating the user about this Radicle fact
    - event for review of any revision, with the following data:
      - icon thumbs-up/thumbs-down/person-speaking matching the review verdict (accept/reject/null)
      - verdict of the review
      - a mention that the review was posted with "with code-inlined comments", if applicable
      - comment summary
        - not shown if empty
      - comment body
        - supports markdown
        - hidden under an expand-on-click control
        - not shown if empty
    - event for standalone-comment/discussion posted on a revision, with the following data:
      - icon comment/comment-unresolved, as well as clear textual indication for the latter case
      - whether the post was in reply to another former standalone comment
        - on click:
          - intelligently smooth-scrolls to bring that parent comment into view, if needed
          - shows a "pulse-outline" animation around the parent comment's event in the Activity section
      - comment body
        - supports markdown
        - hidden under an expand-on-click control
          - if the content is longer than 65 characters
          - or if the content is multi-paragraph, breaking among the first 65 chars (with use of double-line-break)
            - when multi-paragraph, only the first line is shown in the expand-on-click control's summary
          - control's summary shows unparsed Markdown
          - control's summary turns down to 50% opacity when expanded to further denote state and visually differentiate possibly duplicate content between summary and details
      - emoji reactions to the comment
        - same behaviour as described for patch section
    - patch merge
      - shown anew each time a different delegate merges the same patch (must happen multiple times for repos with this requirement set)
    - all of the above events also show:
      - shortened revision id
        - shows the revision description on hover, if available
        - on click:
          - selects that revision in the Revision section
          - intelligently smooth-scrolls to bring the Revision-selector control into view if needed
          - shows a "pulse-outline" animation around the Revision-selection control which just got updated
      - event author/initiator alias, or if not available, their truncated Did
        - shows the full Did on hover
  - the Activity an Revision sections come with fine-tuned responsiveness features depending on the webview viewport's width
    - when the viewport is wide they are shown in a 50/50 split two-column layout
    - as the viewport is getting narrower the Revision column gets narrower _faster_ (resulting in e.g. 70/30 split) to prioritize giving the Activity section maximum of the available horizontal real-estate since it not only hosts relatively more important content, but also one that is commonly wrapping around into new lines due to how expansive it can be. Even a few pixels narrower Activity column can result in very quickly stretching it's contents vertically as it wraps around itself.
    - when the viewport becomes less than 640px the columns will collapse in a single one and the two respective sections will get joined in a tabbed layout. State such as the selected revision in the section's dropdown persist across tab switching and column-layout changes
  - Markdown parsing comes with multiple additional features such as
    - code highlighting with an aditional label communicating the language the code is identified and highlighted as
    - task list e.g. `- [ ] task to do` and `- [X] task done`
    - SVG
    - emoji e.g. `:car:` =>  `🚗`
      - emoticons remain untouched e.g. `:)` => `:)` instead of it getting converted to `😀`, which may not match the author's initial sentiment
    - marked text e.e. `==marked==` => `<mark>inserted</mark>`
    - footnote references e.g.

        ```md
        Here is a footnote reference,[^1] and another.[^longnote]

        [^1]: Here is the footnote.
        [^longnote]: Here's one with multiple blocks.
        ```

    - subscript e.g. `C~7~H~14~O~2~`
    - superscript e.g. `x^2^`
    - abbreviation e.g. this input:

        ```md
        *[HTML]: Hyper Text Markup Language
        *[W3C]:  World Wide Web Consortium
        The HTML specification is maintained by the W3C.
        ```

        results in:

        ```html
        <p>The <abbr title="Hyper Text Markup Language">HTML</abbr> specification is maintained by the <abbr title="World Wide Web Consortium">W3C</abbr>.</p>
        ```

    - automatic table of contents generation wherever the marker `[toc]` is placed, based on previously declared headings etc
    - automatic linkification of text such as email URIs
  - patch state remains in sync with all other views
  - where applicable the various data have on-hover indicators hinting that they come with a tooltip which shows additional info such as author's DID, full Id in case it's shortened, or localised time (including the timezone used) in full text in case it's a "time-ago", etc
  - all data coming from Radicle is made visually distinct (and a bit more accessible / easier to read) from miscellaneous UI copy by rendering it using a monotype font
- **commands:** add new command to check out the current Radicle project's default Git branch
- **patch-list:** show button to "Check Out Default Git Branch" for the currently checked-out patch on the list
- **patch-list:** auto-retry fetching list of patches from httpd (with geometric back-off) if an error occured
- **patch-list:** show the total count of patches and when the list was last updated as a description next to the "Patches" view title
  - "updated-time-ago" gets auto-updated to remain accurate as time goes by or when the list is manually refreshed
  - in case of fetch error no count will be shown
- **patch-list:** improve patch tooltip with the following
  - show merge revision id and commit hash (if not already shown in revision event's copy) for merged patches
  - show latest revision id and commit hash for patches with more than the initial revision
- **patch-list:** prioritize patch merge event over latest revision when deriving author and "time-ago" for item's description and order in the list
- **patch-list:** improve legibility of time when patch events (e.g. created, last updated, merged) happened
  - don't show full dates to make the copy less noisy. The full dates are still available in the new patch detail view.
  - use custom "time-ago" logic producing more informative results with fewer collisions e.g. "35 days ago" instead of "1 month ago" etc
- **patch-list:** move button for command "Copy Patch Identifier to Clipboard" into patch item's context menu
- **patch-list:** use smaller dot as separator between data in the description of a patch item
- **sidebar:** the initial height of the Patches view (e.g. for new projects) will now be 4x that of the CLI Commands view, instead of having the area allocation split 50:50 which resulted in wasted empty space allocated to the later view while the former may have the need for more area to show more content. Subsequent adjustments by the user will be respected and not get overwritten by the initial size.
- **onboarding:** add the new default path `~/.radicle/bin/rad` defined in https://radicle.dev/install script to the list of watched paths previously defined for the legacy package-manager-based installers
- **onboarding:** replace current standard views and an error notification shown when the Radicle CLI binary didn't get resolved succesfully, with a new dedicated Welcome View explaining the situation, setting user expectations accordingly and offering to launch the troubleshooting flow via a button.
- **onboarding:** replace whichever Welcome View ends up randomly beeing shown for a split-second while the extension is acticating with an "Activating extension..." one
- **commands:** add new command to launch Radicle CLI installation troubleshooter (available only when binary hasn't resolved)

### 🔥 Performance

- **patch-list:** only re-render the affected patch item(s) when checking out a(nother) patch (or a non-patch) branch. Previously all patches had to be re-fetched, parsed and all their list items (and their tooltips!) needed to be instantiated and rendered every time a different git branch got checked out.
- **app:** shorten the amount of time the extension needs to get activated down to about 70% of what it was before

### 🩹 Fixes

- **commands:** don't always show empty project list for command `radicle.clone` command. Now the list will also be shown with the most seeded repos at the top. Addresses regression caused due to a breaking change in Radicle HTTP API (httpd).
- **commands:** fix `radicle.clone` command not showing number of users seeding each repo in the list items. Addresses regression caused due to a breaking change in Radicle HTTP API (httpd).
- **onboarding:** fix regression causing the extension to error out (with informative error message but still...) when the path to the Radicle CLI binary didn't resolve successfully.
- **onboarding:** re-check if repo is rad-initialized and as a result properly adjust which views are available if starting without a resolved Radicle CLI and then troubleshooting it successfully (e.g. installing it for the first time).

### 🏡 Chores

- **webview:** implement infrastructure for Webviews, effectively individual websites inside a WebviewPanel, enabling the creation of bespoke custom views with the following powerful features
  - webviews can be full blown web-apps powered by Vue.js, Vite, VueUse, TailwindCSS and other great tech
  - UI in Webviews seamlessly blends with VS Code's familiar look'n'feel, even adjusting to each user's color theme
  - Webviews can have bi-directional communication with the host VS Code extension
  - initial state can be injected into a Webview, allowing reuse of already fetched data and reducing the need for loading spinners on init
  - auto-save Webview state (e.g. text in input fields) when it becomes a background tab and auto-restore it when it becomes visible again
  - auto-save Webview state and auto-restore it if VS Code is restarted with the Webview panel open
  - each new Webview panel opens in the currently active ViewColumn, if multi-column layout is in use (i.e. split editors)
  - Webview panel gets reused without being destroyed if it is re-invoked when the user has a ViewColumn active which isn't the one already containing the running Webview
  - text content in Webviews can be searched with Ctrl + F and additional actions Copy/Paste/Cut are available on right click or by using their common keyboard shortcuts
  - Webviews are secured with strict Content Security Policy (CSP)
- **state:** rewrite shared state management across the entire extension from simplistic, localised, highly interdependent and brittle, procedural approach to a new declarative, reactive, global, scalable architecture powered by [`pinia`](https://pinia.vuejs.org/) and [`@vue/reactivity`](https://www.npmjs.com/package/@vue/reactivity). This enables sharing state across sibling views/entities that was previously too hard, enabling more performant solutions and features that were previously too impractical to tackle, while the code for them can be much more maintainable and less likely to regress in the future.
- **httpd:** update typings to align with latest Radicle HTTP API endpoint schema updates

### 📖 Documentation

- **readme:** fix typos, improve title and intro copy, update milestone link
- **contributing:** document recommended extensions for development with VS Code in [.vscode/extensions.json](.vscode/extensions.json) and add related section in the repo's contribution guide.
- update all references using the now deprecated term "track" to the new term "seed" aross our docs

---

## **v0.3.2** (Nov 29th, 2023)

### 🚀 Enhancements

- **patch-list:** show a button to check out a Radicle patch's associated git branch ([#75](https://github.com/cytechmobile/radicle-vscode-extension/issues/75))
  - show an indicator on the patch's title and tooltip if its associated branch is the currently checked-out git branch
  - keep indicator's state in sync even if the git branch change doesn't happen from within our UI (e.g. `rad patch checkout` or `git checkout` in the terminal)
  - notify user of uncommitted changes when trying to check out a patch
  - don't show check-out-button for the currently checked-out patch on the list
- **patch-list:** auto-refresh list when `pathToNodeHome` is updated in the extension settings
- **patch-list:** show a hint-text that radicle-httpd may not be running as the placeholder in Patches view, if that seems to be the case
- **patch-list:** fall back to showing their DID if the revision author's alias isn't defined ([#75](https://github.com/cytechmobile/radicle-vscode-extension/issues/75))
- **patch-list:** use new better-fitting icon for merged patches ([#75](https://github.com/cytechmobile/radicle-vscode-extension/issues/75))
- **patch-list:** improve the contrast of the colors used by patch status icons for light themes ([#75](https://github.com/cytechmobile/radicle-vscode-extension/issues/75))

### 🔥 Performance

- **app:** heavily speed up most procedures by memoizing the resolution of the reference to the rad CLI ([#75](https://github.com/cytechmobile/radicle-vscode-extension/issues/75))
- **patch-list:** heavily speed up (re-)loading of Patches view ([#75](https://github.com/cytechmobile/radicle-vscode-extension/issues/75))
  - measured ~50x faster against a real-world Project with >50 patches, with the benefit increasing proportionally with the count of patches on a project

### 📖 Documentation

- **contributing:** document how to package locally from source and import into VS Code
- fix some screenshots that were getting stretched to incorrect ratios

---

## **v0.3.1** (Oct 3rd, 2023)

### 🩹 Fixes

- **cli:** migrate to using the new flag for sourcing the current Project's RID, which handles the breaking Radicle CLI change, resulting in Patches View getting stuck with `Unable to fetch Radicle patches for non-Radicle-initialized workspace`. ([#90](https://github.com/cytechmobile/radicle-vscode-extension/issues/90))

---

## **v0.3.0** (Oct 2nd, 2023)

### ✨ Highlights

- New Patches view

    ![screenshot of Radicle Patches view](./assets/for-md/patches-diff.png)

### 🚀 Enhancements

- **patch-list:** show new view in the sidebar listing all Radicle Patches, including a tooltip with more info on hover and the ability to easily copy the Patch identifier ([#43](https://github.com/cytechmobile/radicle-vscode-extension/issues/43))
- **patch-list:**  each item in the list of Radicle Patches can be expanded to show a sub-list of files changed.  ([#46](https://github.com/cytechmobile/radicle-vscode-extension/issues/46))
  - If multiple items have the same filename, their directory URL will be additionally shown as the item's description.
  - On hover, a tooltip shows the relative URL of the file in the repo, and the kind of change it had.
  - A left click on a filechange item will open a diff between the original and patched file versions.
  - A right-click allows opening either the original or changed file versions (as applicable) without the diffing visual noise.
- **commands:** new VS Code command to refresh the list of Radicle Patches ([#43](https://github.com/cytechmobile/radicle-vscode-extension/issues/43))
- **commands:** new VS Code command to collapse all items in the list of Radicle Patches ([#46](https://github.com/cytechmobile/radicle-vscode-extension/issues/46))
- **ux:** convert existing flows with series of user input steps into a bespoke, cohesive experience indicating total step count and completion progress, allow editing of already submitted answers of the same flow, as well reveal-toggling of typed-in passwords, among other improvements ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **auth:** additionally show the alias associated with a Radicle identitifier whenever showing the latter ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))

### 🛡️ Security Fixes

- **auth:** prevent potential leaking of `RAD_PASSPHRASE` into the JavaScript console ([#70](https://github.com/cytechmobile/radicle-vscode-extension/issues/70))

### 🩹 Fixes

- **auth:** don't allow the user to submit an empty string as an alias when creating a new radicle identity ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **auth:** warn the user that an empty passphrase will result in an unencrypted Radicle key when creating a new radicle identity ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **auth:** don't ask users with empty-passphrase-identities to enter their (blank) passphrase each time an auth-guarded Radicle command is executed ([#71](https://github.com/cytechmobile/radicle-vscode-extension/issues/71))
- **auth:** ask the user to re-enter their chosen passphrase when creating a new radicle identity to protect agains typos and align with Radicle CLI's UX ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **auth:** show "created new" instead of "unlocked" in the notification and logs when creating a new radicle identity ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **auth:** cancel the whole flow, warn and notify user when pressing escape _at any step of the flow_ (previously only applied for the passphrase question) when user is asked for his input in order to create a new radicle identity ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **httpd:** show buttons opening Output or the related configuration option in Settings in the event of Fetch Error ([#39](https://github.com/cytechmobile/radicle-vscode-extension/issues/39))

### 💅 Refactors

- **ux:** wrap VS Code's lackluster [InputBox API](https://code.visualstudio.com/api/references/vscode-api#InputBox) resulting in procedural, verbose and brittle client code, with a new custom-built sensible wrapper ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))
- **httpd:** design and implement architecture for idiomatic code interacting with the Radicle HTTP API ([#39](https://github.com/cytechmobile/radicle-vscode-extension/issues/39))

### 📖 Documentation

- **readme:** use up-to-date screenshots for Integrated Authentication features ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))

---

## **v0.2.2** (July 29th, 2023)

### 🩹 Fixes

- **commands:** replace pre-heartwood, now deprecated rad pull/push commands with fetch/announce across multiple UI locations ([#42](https://github.com/cytechmobile/radicle-vscode-extension/issues/42))
- update from old (seedling) to new (alien) Radicle logo and branding ([#56](https://github.com/cytechmobile/radicle-vscode-extension/issues/56))
- **auth:** fix creation of new Radicle identity which now requires a mandatory alias ([#67](https://github.com/cytechmobile/radicle-vscode-extension/issues/67))

### 💅 Refactors

- **cli:** leverage new `rad self` calling options in place of the former brittle char-based string parsing of Radicle CLI's output ([#64](https://github.com/cytechmobile/radicle-vscode-extension/issues/64))

### 🏡 Chores

- **ts:** forbid implementing runtime logic in .d.ts files [2ccd94b](https://github.com/cytechmobile/radicle-vscode-extension/commit/2ccd94be1c42fafa1a39f1db90bb4d65199f8624)
- **ts:** skip checking npm module grammar for a ~40% compilation speedup [55d4811](https://github.com/cytechmobile/radicle-vscode-extension/commit/55d48119b21f030c42432f765e187a3c13f4e649)
- **deps:** upgrade all dependencies to latest version [5227b70](https://github.com/cytechmobile/radicle-vscode-extension/commit/5227b709f2d19426f04a43f6f75cb26b2326756f)

### 📖 Documentation

- **readme:** update screenshots to show the UI updated with the new branding ([#56](https://github.com/cytechmobile/radicle-vscode-extension/issues/56))

---

## **v0.2.1** (June 29th, 2023)

### 🩹 Fixes

- **onboarding:** don't get stuck in "non-rad-initialized repo" Welcome View, despite having a rad-initialized repo open ([#52](https://github.com/cytechmobile/radicle-vscode-extension/issues/52))
- **onboarding:** address typos and improve copy of "non-rad-initialized repo" Welcome View ([#52](https://github.com/cytechmobile/radicle-vscode-extension/issues/52))
- **onboarding:** don't point the user to no-longer existent Getting Started guide ([#52](https://github.com/cytechmobile/radicle-vscode-extension/issues/52))

### 💅 Refactors

- **when-clause-context:** rename `isRepoRadInitialised` --> `isRadInitialized` ([#52](https://github.com/cytechmobile/radicle-vscode-extension/issues/52))

### 📖 Documentation

- **readme:** use up-to-date screenshot of "non-rad-initialized repo" Welcome View in Onboarding examples ([#52](https://github.com/cytechmobile/radicle-vscode-extension/issues/52))

---

## **v0.2.0** (June 28th, 2023)

### ✨ Highlights

- ❤️🪵 Initial ["Heartwood"](https://app.radicle.at/nodes/seed.radicle.at//rad:z3gqcJUoA1n9HaHKufZs5FCSGazv5) support
- 🔐 Integrated authentication
- 📥 Cloning of seeded Radicle projects
- 🏗️ Improved development tooling and infrastructure for maintainers

### 🚀 Enhancements

- **commands:** wrap Radicle CLI commands (`sync`, etc) with auth requirement ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **auth:** unlock existing and create new Radicle identities using familiar VS Code UX ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **auth:** validate passphrase correctness in realtime as the user is typing it ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **auth:** securely store passphrase after successful user input and autotomatically re-use next time (if available) ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **commands:** new VS Code command to de-authenticate / re-lock the currently used Radicle identity and remove the associated passphrase from Secret Storage ([#33](https://github.com/cytechmobile/radicle-vscode-extension/issues/33))
- **log:** indicate in logs and notifications if an identity was pre-unlocked, got auto-unlocked using stored passphrase, got unlocked with user provided passphrase, or got created anew ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **settings:** new `pathToNodeHome` setting, which sets the `RAD_HOME` env variable ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **settings:**  new `httpApiEndpoint` setting, useful when reverse-proxies are running in front of `radicle-httpd` etc ([#26](https://github.com/cytechmobile/radicle-vscode-extension/issues/26))
- **commands:** new VS Code command to clone a Radicle project from a filterable list of all seeded ones ([#27](https://github.com/cytechmobile/radicle-vscode-extension/issues/27))
- **commands:** show rad clone command in the native Source Control three-dot-menu's Radicle submenu ([#27](https://github.com/cytechmobile/radicle-vscode-extension/issues/27))
- **onboarding:** when opening VS Code without any folder in the workspace show in the dedicated Welcome View an additional button to clone from Radicle ([#27](https://github.com/cytechmobile/radicle-vscode-extension/issues/27))
- **settings:** set default value for existing config `pathToRadBinary` ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **log:** log auth status on extension init as well as on `pathToCliBinary` and `pathToNodeHome` configs' change ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))

### 🩹 Fixes

- **settings:** use previously ignored config `pathToCliBinary` to resolve Radicle CLI before executing commands ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **log:** don't log `body` param if it is empty string
- **log:** escalate user notification shown when Radicle CLI is not resolved from warning to error ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))

### 💅 Refactors

- **store:** create new global store for extension context and replace func param drilling with new getter ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **exec:** completely rewrite foundational logic for shell script execution to be simpler, more powerful and result in cleaner client code ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **settings:** use new typesafe getter and setter for accessing VS Code configuration options ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **settings:** rename config `pathToBinary` -> `pathToCliBinary` ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **repo:** move functions out of overgrown `utils` directory and into new `helpers` and `ux` directories ([#34](https://github.com/cytechmobile/radicle-vscode-extension/issues/34))
- **repo:** add readme files documenting the intended contents of `utils`, `helpers` and `ux` directories ([8da729e](https://github.com/cytechmobile/radicle-vscode-extension/commit/8da729ee16726484859cf4c56592c7d7189699f8))

### 🏡 Chores

- **build:** support runtime dependencies by bundling them and our source code for production using esbuild ([#41](https://github.com/cytechmobile/radicle-vscode-extension/issues/41))
- **lint:** massively improve code linting ruleset, integrate code formatter in it and update all source code to comply ([#13](https://github.com/cytechmobile/radicle-vscode-extension/issues/13))
- **lint:** auto-fix most code linting & formatting issues on save for VS Code users with ESLint extension installed ([#13](https://github.com/cytechmobile/radicle-vscode-extension/issues/13))
- **deps:** migrate to Typescript v5.0 ([1234e06](https://github.com/cytechmobile/radicle-vscode-extension/commit/1234e06112ecc941c213614852bdb53037cd6833))

### 🤖 CI

- **ci:** set-up github actions for pull requests ([#1](https://github.com/cytechmobile/radicle-vscode-extension/issues/1))

### 📖 Documentation

- **readme:** add CTA advertising the change log ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **readme:** bring up to date with latest changes ([#48](https://github.com/cytechmobile/radicle-vscode-extension/issues/48))
- **changelog:** add release date to title of each version and separators above them ([#28](https://github.com/cytechmobile/radicle-vscode-extension/issues/28))
- **changelog:** reference related PRs/commits for each change ([#48](https://github.com/cytechmobile/radicle-vscode-extension/issues/48))

---

## **v0.1.2** (April 25th, 2023)

### 🩹 Fixes

- **commands:** hide Radicle commands from UI when they are not applicable ([#25](https://github.com/cytechmobile/radicle-vscode-extension/issues/25))

### 🏡 Chores

- **git:** define known scopes for conventionalCommits extension ([ded7fcf](https://github.com/cytechmobile/radicle-vscode-extension/commit/ded7fcf64d7864a95a96bc53df0512d41bfbe0f5))

### 📖 Documentation

- **readme:** add missing reference to integrated logging feature
- **readme:** fix link to Radicle homepage
- **readme:** fix broken reference to image showcasing integrated logging feature
- **changelog:** prefix changes with context and remove quotations formatting

---

## **v0.1.1** (April 5th, 2023)

### 🩹 Fixes

- **commands:** use a more minimal UI to notify user of Radicle command success
- **onboarding:** typo fix in copy of non-rad-initialized repo's Welcome View (thanks for reporting @bordumb 🙌)

### 📖 Documentation

- **readme:** revamp with simpler feature list, visual examples of each and a short definition of the Radicle network
- **changelog:** polishing of enhancements list of v0.0.1

---

## **v0.1.0** (April 5th, 2023)

Minor version bump to officially mark the release of the long-awaited MVP! 🥳

Please refer to [v0.0.1](#v001) for the shiny features list ✨ (bear with us as we work out our versioning/release/changelog/documentation flows)

### 📖 Documentation

- **changelog:** improve copy of features list

## **v0.0.3** (April 5th, 2023)

### 📖 Documentation

- **readme:** update and partially extract content to CONTRIBUTING

---

## **v0.0.2** (April 5th, 2023)

### 🏡 Chores

- **publish:** remove unnecessary files from published artifact

### 📖 Documentation

- **changelog:** introduce Changelog

---

## **v0.0.1** (April 5th, 2023)

An MVP bringing getting-started and troubleshooting flows as well as basic (pre-Heartwood) Radicle integration to VS Code.

### 🚀 Enhancements

- Radicle icon in Activity Bar opening the main extension View
- Buttons to execute Pull, Push Sync Radicle commands in the main extension View
- Button to execute Sync Radicle command in native Source Control View's title buttons (above commit message input)
- Commands to execute Pull, Push Sync Radicle commands in VS Code's Command Palette (Opens with Ctrl+Shift+P or Cmd+Shift+P)
- List items to execute Pull, Push Sync Radicle commands grouped in a "Radicle" submenu inside the native Source Control View's three-dot-menu
- User notification on success/failure of executed Radicle commands with the option to view the CLI's output
- Log including extension's and Radicle CLI's version in the Output Panel
- Command to show extension's Log in VS Code's Command Palette
- Multi-step onboarding flow with dedicated Welcome Views for specific Workspace states
- Multi-step and multi-branch Radicle CLI installation troubleshooting flow helping the user point the extension to a Radicle CLI binary
- Configurable path to CLI binary in the Settings (by default will not sync VS Code instances as other user settings do)
