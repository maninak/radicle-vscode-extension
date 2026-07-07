# Contribution Guide

If you are interested in contributing to the development of the Radicle VS Code Extension keep reading for information and instructions.

## Contributing With Sponsorship

Code, issues and spreading the word are all valuable. So is helping fund the time that goes into this project. If you would like to chip in, [recurring micro-donations on Liberapay](https://liberapay.com/maninak/donate) are much appreciated and help keep this extension maintained and available for everyone for free. Only sponsor if you can comfortably spare it.

[![Sponsor maninak on Liberapay](https://img.shields.io/badge/Liberapay-Donate-F6C915?logo=liberapay&logoColor=black)](https://liberapay.com/maninak/donate)

## Contributing With Feedback, Questions and Ideas

Please always be respectful to the maintainers and all other community members. Here's how to reach out:

### Chat

If there's anything you need to ask or share with the maintainers, we'd love to hear from you on the community's [Zulip channel](https://radicle.zulipchat.com/#narrow/stream/380896-integrations). Create a new topic prefixed with [vscode] e.g. `[vscode] <your topic's subject here>` and anything you want to say. Somebody will get back to you ASAP.

### Issues

For more concrete issues like specced out features and bug reports you could also file an issue in our [repo](https://app.radicle.at/nodes/seed.radicle.at/rad:z3Makm6fsQQXmpSFE43DZqwupaEhk) with the [CLI](https://radicle.dev/guides/user#working-with-issues). Make sure to [clone the `radicle-vscode-extension` repo](#cloning-the-radicle-vscode-repo-repo-locally) if you haven't already.

When filing an issue please:

1. try to provide as much context and be as clear as possible while also being terse and to the point
2. if you are filing a bug then also provide reproduction steps as well as the expected and actual behaviours
3. be patient, considerate of the maintainers' time and their existing priorities. In case your issue can't be addressed in your ideal timeframe, consider creating a patch, letting us know about it and which in the meantime you can [package and install in your vscode](#packaging-locally-from-source).

## Contributing With Code

Code contributions are the best kind of contribution! Please make sure to read this document in its entirety to get up to speed with the various details.

> If you're interested in making a code contribution, especially if it's your first time for this repo, we strongly advise that you go with a small, if not trivial changes, and definitely ensure that they don't affect the application, its existing features, UX and general direction in a major way. When in doubt it's always best to consult with the maintainers before investing too much of your time.

## Cloning the `radicle-vscode-repo` Repo Locally

Choose any of the following options:

### Cloning Using the Radicle Extension Itself

Open VS Code's Command Palette (`Ctrl/Cmd + Shift + P`) and type in `> rad clone` then run the related command shown and follow the instructions.

### Cloning Using the Radicle CLI

```sh
rad clone rad:z3Makm6fsQQXmpSFE43DZqwupaEhk
```

You can find more info about `rad clone` in the [Radicle User Guide](https://radicle.dev/guides/user#the-basics-of-seeding-and-cloning).

## Launching for Local Development

After [cloning the repo locally](#cloning-the-radicle-vscode-repo-repo-locally) and opening it in VS Code, run the `Develop Extension` configuration from the "Run and Debug" View. This will:

- ensure you have the required dependencies and auto-align as needed
- start the VS Code task `npm: dev` to compile the source code
- launch a new VS Code window with the extension running in it
- show the console output, including any errors in a new terminal named `dev`

> Tip: Or just press `F5` to achieve the same thing.

## Dev Workflow

While the `npm: dev` task is running you get a fast inner loop with no manual relaunches:

- **Webview changes** (anything under `src/webviews`) hot-reload in place via the Vite dev server. Save a `.vue`, `.ts` or `.css` file and the open panel updates instantly, keeping its current state. No rebuild, no window reload.
- **Extension host changes** (anything under `src`, outside `src/webviews`) are rebuilt by `esbuild --watch`, after which the host window reloads itself automatically within a second or so.

The `npm: dev` task and its watchers stay alive after a debug session ends, on purpose. Re-pressing `F5` reuses them, skipping dependency verification and the initial build, so subsequent launches are nearly instant. Stop the task manually (trash can icon on its terminal) when you're done for the day or close VS Code.

> The webview HMR path loads modules from the Vite dev server at `http://localhost:5173` and only kicks in when the extension runs in development mode. Production builds bundle the pre-built assets shipped inside the extension, exactly as before. HMR currently targets local development; remote scenarios (Remote-SSH, Codespaces) would need extra `asExternalUri` plumbing.

## Debugging

For standard extension code (aka not code running in webviews a.k.a. mini websites), place stop points in the standard way next to the line counter and use the native debugger.

For code running _inside_ webviews use the command "Toggle Developer Tools" from the palette which will open the familiar chrome dev tools. You can now place stop points in there and inspect HTML and CSS just like in chrome; because it is chrome(ium).

## Recommended Extensions

While not required, for development it's strongly advised to have all the [recommended VS Code extensions](.vscode/extensions.json) installed and enabled in the workspace of this repo.

## Conventions

### Code Linting

A pretty powerful linter configuration and setup will cover most superficial topics (e.g. spaces, single quotes, no semi, dangling commas, sorted imports, etc) as well as many best practices and some convensions. It lints all changed files when commiting and also runs on CI against patches.

If you notice anything fishy, annoying (red squiggle should be yellow, conflicting rules, common false positive etc), broken or missing, please let the maintainers know.

### Code Style

- Keep it simple, not "smart"
- Code must be understandable without the need for any comments. If you feel the need for a comment improve your code instead.
- Follow existing convensions across the repo and ensure your solution aligns with them
- Be as consistent as possible in naming, handling things, etc.
- Prefer functional vs imperative or object-oriented programming (if it can be avoided and doing otherwise doesn't make more sense in that context).
- Every time you write a "todo" comment always add your name right after it. You're responsible to resolve it, ideally before merging the PR.
- Use CamelCase for .vue files and kebab-case for everything else
- Follow [VS Code UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) to a "T"
- Follow [Vue](https://v2.vuejs.org/v2/style-guide) community conventions
- Name similar things similarly e.g. `EmployeeCard.vue` & `EmployeeCardList.vue`
- Use `*List` suffix for dedicated containers component like shown above (even if they are rendered in a grid or whatever). Avoid doing it if the container is indepedent and could support any child component.

### Git Foo

- Uphold commit history quality; commits are documentation people read to understand both the what and the why if not self-explanatory from your code. Don't be afraid to use the commit body if needed to further explain what a commit diff alone doesn't.
- Use [Conventional Commits](https://www.conventionalcommits.org) e.g. `refactor(auth): simplify sign-in logic`
  - You can and are advised to use the VS Code extension [Conventional Commits](https://marketplace.visualstudio.com/items?itemName=vivaxy.vscode-conventional-commits) to help you out.
- In a PR/Patch description always append `Closes #<issue-id>` when applicable or `Closes no specific issue` when not (ensure that this is the case!).
- If you're introducing a change that breaks/extends/amends a convention, after ensuring you've done your best to avoid it, try to align pre-existing code as needed, ideally in the same PR/Patch but in a separate commit from other unrelated changes.
  - Consider discussing with the team before investing the time.
- Sign your commits with at minimum a [DCO](https://developercertificate.org/) (Developer Certificate of Origin) text signature
  - If you use the command line make sure to use the flag `--signoff` or `-s` when commiting e.g. `git commit --signoff`
  - If you use VS Code's built-in git commit UI, the repo is configured to sign for you automatically
- Ideally sign your commits with a PGP cryptographic signature too. Here's a guide [how to set up PGP signing for git commits](https://docs.github.com/en/authentication/managing-commit-signature-verification).

### Package Management

We use [`pnpm`](https://pnpm.io/motivation) for node package management (f you use npm or yarn by mistake, no worries, there are fail-safes in place to save you from breaking something).

> Tip: Check out [`ni`](https://github.com/antfu/ni) to never think again about which package manager to use in which repo.

#### Usage Without pnpm Globally Installed

If you _don't_ already have `pnpm` globally installed and don't want to do that, you can always prefix each pnpm command with `npx`.

```sh
pnpm install a-new-pkg # if this is what you need to do
npx pnpm install a-new-pkg # you can achieve it like this
```

### Importing Extension Modules Inside Webview Modules

Any of the extension's modules (e.g. a file containing a TS type or a util function) we need to import inside a webview module (e.g. a .vue file) must be also declared as an import in [src/webviews/tsconfig.app.json](src/webviews/tsconfig.app.json) under `includes`.

Moreover we must ensure that each of those extension modules defined for the aforementioned `includes` property of the webviews app _does not import any other modules NOT defined under that same property_. That implies a clean organization of modules and a clear separation of concerns for the code inside each of them.

If necessary, specific code shared between extension and webviews should be extracted in dedicated shared modules.

### Getting User Input

Use custom wrapper `askUser()` instead of the native [InputBox API](https://code.visualstudio.com/api/references/vscode-api#InputBox) which would result in procedural, verbose and brittle client code.

### Copywriting

- All user facing controls and UI e.g. buttons, tooltips, etc should use [Title Case (Wikipedia style)](https://titlecaseconverter.com)
- Notifications should not contain a trailing fullstop unless multiple sentences are used.
- Success and Warning notifications should begin with what happened first e.g. "Updated patch title successfully"
- Error notifications should begin with "Failed" e.g. "Failed updating patch title"
- Copy, or parts of it, that represents data and which is dynamic should be depicted using monotype font. Similarly copy that is static should be depicted using non-monotype font. e.g. in the copy "Check Out master", where "master" is the name of the default branch of a repo, "master" should be depicted with monotype font "Check Out" without.
- The above is usually possible in webviews and impossible in extension UIs. In the latter case the dynamic values should be depicted as being wrapped by double quotes e.g. 'Using Radicle identity "maninak"'

## Packaging Locally From Source

We can create a distributable build, similar to the one published on the marketplace, that anyone can use to test unreleased versions, quick changes and forks.

After [cloning the repo locally](#cloning-the-radicle-vscode-repo-repo-locally) and changing into the cloned repo's directory, run in your terminal:

```sh
npx vsce package --no-dependencies
```

This should generate a .vsix file which you can then import into VS Code (`Ctrl + Shift + P` + "install vsix").

## Publishing

### Microsoft Marketplace

Get a [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_get-a-personal-access-token) and login with it:

```sh
npx vsce login radicle-ide-plugins-team
```

Make sure you have checked out the correct branch, choose if you want to increment patch, minor or major version and run:

```sh
npx vsce publish patch --no-dependencies
```

### Open VSX Registry

After having completed the above you should have a packaged version of the extension at the repo root directory named like "radicle-0.6.1.vsix". If not, [repackage](#packaging-locally-from-source).

Then get an [Open VSX access](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions#3-create-an-access-token) token.

```sh
npx ovsx publish radicle-[x.y.z].vsix -p my-openvsx-token
```
