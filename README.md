![radicle-screenshot](./assets/for-md/hero.png)

# Radicle VS Code Extension

[![Sponsor maninak on Liberapay](https://img.shields.io/badge/Liberapay-Donate-F6C915?logo=liberapay&logoColor=black)](https://liberapay.com/maninak/donate)

[![Visual Studio Marketplace Version](https://flat.badgen.net/vs-marketplace/v/radicle-ide-plugins-team.radicle?color=6EA900&label=version)](https://marketplace.visualstudio.com/items?itemName=radicle-ide-plugins-team.radicle)
[![Visual Studio Marketplace Downloads](https://flat.badgen.net/vs-marketplace/d/radicle-ide-plugins-team.radicle?color=55A2EE&label=VS%20Marketplace%20Downloads)](https://marketplace.visualstudio.com/items?itemName=radicle-ide-plugins-team.radicle)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/radicle-ide-plugins-team/radicle?style=flat&logo=openvsx&logoColor=FFFFFF&label=Open%20VSX%20Downloads&color=C160EF&cacheSeconds=64800)](https://open-vsx.org/extension/radicle-ide-plugins-team/radicle)
[![rad: - z3Makm6fsQQXmpSFE43DZqwupaEhk](https://img.shields.io/static/v1?label=rad%3A&message=z3Makm6fsQQXmpSFE43DZqwupaEhk&color=6666FF&cacheSeconds=64800)](https://app.radicle.at/nodes/seed.radicle.at/rad:z3Makm6fsQQXmpSFE43DZqwupaEhk)
[![Roadmap](https://img.shields.io/badge/Roadmap-orange)](https://github.com/users/maninak/projects/1/views/1)

A VS Code extension bringing support for the Radicle network to your IDE.

[Radicle](https://radicle.dev/) is a decentralized, local-first and sovereign code forge alternative to GitHub. It's built on top of Git and operates on the free, peer-to-peer and open-source Radicle network.

> **NOTE:** The extension currently offers a limited feature set. Deeper integration of Patches and then Issues is planned and tracked on the [🗺️ Roadmap](https://github.com/users/maninak/projects/1/views/1).

## Features

> _See the latest, as well as merged and upcoming updates in the [🗒️ Change Log](./CHANGELOG.md)._

- 🖲️ [Radicle Commands](#integrated-radicle-commands) everywhere you need them
- 📋 [Patches View](#patches-view) offers a glance at the status of code changes in your repository
- 📑 [Patch Detail View](#patch-detail-view) gives you in-depth information and interactivity for a specific patch
- 🔐 [Integrated Authentication](#integrated-authentication) eases your Radicle Identity management
- 📥 [Cloning](#cloning) of seeded Radicle repos
- 🗺️ [Onboarding Flow](#onboarding-flow) with tips tuned to whichever state your Workspace is in when starting out
- 🕵️‍♂️ [Troubleshooting Flow](#troubleshooting-flow) helping you point the extension to a Radicle CLI binary (if it didn't already auto-resolve)
- 🎛️ [Configurable](#configurable) via VS Code's native Settings
- 📜 [Integrated Logging](#integrated-logging) including Radicle CLI's command output

### Integrated Radicle Commands

- Run common Radicle commands with dedicated buttons from within the main extension View

  ![Buttons to execute Radicle commands in the main extension View](assets/for-md/rad-cmds-in-main-view.png)

- Run Radicle commands from within VS Code's Command Palette

  ![Execute Radicle commands from within VS Code's Command Palette](assets/for-md/rad-cmds-in-palette.png)

- Sync with the Radicle network with a dedicated button among the native Source Control View's title buttons (above commit message input)

  ![Sync with the Radicle network with a dedicated button among the native Source Control View's title buttons (above commit message input)](assets/for-md/rad-cmds-in-scm-title.png)

- Find Radicle commands grouped as a "Radicle" submenu inside the native Source Control View's three-dot-menu

  ![Find Radicle commands grouped as a "Radicle" submenu inside the native Source Control View's three-dot-menu](assets/for-md/rad-cmds-in-scm-3dot.png)

### Patches View

Browse Radicle Patches, check out their associated git branches and inspect their file changes and diffs.

![screenshot of Radicle Patches view](./assets/for-md/patches-diff.png)

### Patch Detail View

Inspect all details you'd want to know about a patch including discussions, details of a specific revision as well as all events that took place during the lifetime of the patch.

![Patch detail view](./assets/for-md/patch-detail.png)

### Integrated Authentication

- Create a new Radicle identity, if none exists in your configured Radicle home directory

  ![Create new identity](assets/for-md/auth-create-id.png)

- Unlock an existing identity

  ![Unlock existing identity](assets/for-md/auth-unlock-id.png)

- De-authenticate your currently unlocked identity

  ![de-authenticate identity](assets/for-md/auth-lock-id.png)

### Cloning

- Invoke the CLI's `rad clone` command from the Command Palette

  ![rad clone listed in command palette](assets/for-md/rad-clone-palette.png)

- Select from a filterable list of repos that your Radicle node is seeding

  ![rad clone listed repos](assets/for-md/rad-clone-choose.png)

- Open the newly cloned repo in another VS Code window with a single click

  ![rad clone success](assets/for-md/rad-clone-success.png)

### Onboarding Flow

- No folder opened in Workspace

  ![no folder opened in Workspace](assets/for-md/no-folder-init-welcome-view.png)

- Non-git-initialized folder opened in Workspace

  ![Non-git-initialized folder opened in Workspace](assets/for-md/non-git-init-welcome-view.png)

- Non-radicle-initialized repo opened in Workspace

  ![Non-radicle-initialized repo opened in Workspace](assets/for-md/non-rad-init-welcome-view.png)

### Troubleshooting Flow

![Troubleshooting Flow](./assets/for-md/troubleshoot.png)

### Configurable

Set environment variables for the Radicle CLI and more from VS Code's settings

![Extension configurations](assets/for-md/configs.png)

### Integrated Logging

![Integrated logging](assets/for-md/logs.png)

## Roadmap

Planned and in-progress work is tracked on the [GitHub Project board](https://github.com/users/maninak/projects/1/views/1). See the [Change Log](./CHANGELOG.md) for what has already shipped and what's merged and en route to ship next.

## Contributing

Please see the [Contribution Guide](./CONTRIBUTING.md).

## Support

If this extension saves you time, or you would like to see it keep getting better, here are a few ways to support further development:

- 🌱 Seed this repo on [Radicle](https://app.radicle.at/nodes/seed.radicle.at/rad:z3Makm6fsQQXmpSFE43DZqwupaEhk) and star it on [GitHub](https://github.com/maninak/radicle-vscode-extension)
- 📣 Share it with colleagues, or leave a rating on the [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=radicle-ide-plugins-team.radicle) or [Open VSX](https://open-vsx.org/extension/radicle-ide-plugins-team/radicle)
- 💛 Chip in on Liberapay with a micro-donation, if you can comfortably spare it.

[![Sponsor maninak on Liberapay](https://img.shields.io/badge/Liberapay-Donate-F6C915?logo=liberapay&logoColor=black)](https://liberapay.com/maninak/donate)

Every bit, a kind message included, makes maintaining this and my other open-source tools more sustainable. Thank you!
