# DSH task list

[简体中文](./README.md) · Community plugin; not an official DeepSeek product

[npm package](https://www.npmjs.com/package/@kaifeise/dsh-task-list) · [GitHub releases](https://github.com/1694439208/dsh-task-list/releases) · [Report an issue](https://github.com/1694439208/dsh-task-list/issues)

The repository uses the `dsh-plugin` topic as [recommended by DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness#community-and-support) for discoverability. This does not imply official review or endorsement. Runtime code matches the published npm `1.3.1` release; this repository adds source metadata and documentation links.

A sidebar shortcut opens a cross-workspace conversation list in DeepSeek Harness. Keep completed conversations visible and jump straight to a conversation without browsing individual projects.

## Features

- Keeps all unarchived, nonblank ordinary conversations after their activity ends.
- Marks only confirmed successful completions that are both new since page activation and unread in green.
- Shows older or already-viewed completions as neutral completed rows. Opening a conversation clears its unread reminder through DSH's normal navigation; it does not remove the row.
- Distinguishes running, waiting, queued, failed, stopped, interrupted and unconfirmed results.
- Sorts by recent activity, displays the title and working directory, highlights the current conversation and supports a scrollable list.
- Does not list subagents separately; shows a parent as active while its direct children run.
- Includes Chinese/English text, host theme tokens, Escape dismissal and native modal focus containment.

## Install

In DSH's plugin manager, add this package by name:

```text
@kaifeise/dsh-task-list
```

With the DSH CLI and the `desktop` profile:

```sh
dsh plugin --profile desktop add @kaifeise/dsh-task-list
```

Let the plugin manager install the package and its dependency. Do not hand-edit profile files.

If you installed a local test version, disable or remove `@local/dsh-task-list-unread`, `@local/dsh-task-list` or `@local/dsh-running-sessions` first. Do not enable a local version alongside this package: they share UI cells and a projection domain. Removing a plugin does not delete conversations.

If an update leaves an older view on screen, confirm installation succeeded and reopen DSH after running work has safely finished. Do not interrupt active tasks just to refresh this plugin.

## Reminder semantics

The badge count is the total number of listed conversations, not merely the number running. A conversation is hidden when it is archived, not when it finishes or is viewed.

Green means a **new, unread completion**, not a permanent success label. Completions already being viewed normally have no unread green marker. Reloading the page or plugin starts a new page-level reminder window without deleting conversations or their recorded outcomes.

Completed means the latest Agent turn ended with reason `completed`; it is not independent verification of every external business result. Missing or unclear outcomes remain unconfirmed instead of being inferred from an idle runtime.

## Compatibility and verification

- Declared DSH support is the `0.2.1-rc.5` through `0.2.1` family and the `0.2.2-rc.1` through `0.2.2` family. The exact `engines.dsh` range in the manifest is authoritative; other families are unverified.
- Uses DSH's React runtime, standard Slot hooks, projection registry and workspace navigation service; it does not ship another React copy.
- Requires a modern browser/Desktop WebView supporting native `<dialog>`, `IntersectionObserver` and CSS `color-mix()`.
- 69 pure data, outcome, reminder, queue and view-state regression tests pass, along with build and syntax checks. Installation was checked in a DSH `0.2.1-rc.5` environment; the current `0.2.2-rc.1` page exposes the new live trigger registration.
- These checks are not a complete browser end-to-end, keyboard-focus, cross-platform or light/dark visual test suite.

## Data and permissions

The plugin uses additive sidebar and overlay slots without replacing the workspace browser. The Host folds existing turn boundary events into an incremental outcome projection; the Client does not fold session logs.

Missing historical outcomes load only when rows enter the dialog viewport, with at most four concurrent deduplicated reads. Reads do not start Agents, retain history streams or trigger migration. Unread acknowledgements remain owned by DSH.

The plugin does not submit prompts, create/cancel/terminate tasks, append session events, upload conversation data to external services or collect telemetry. npm/DSH downloads declared dependencies during installation.

## Development

```sh
npm install --ignore-scripts
npm test
npm run build
npm pack --ignore-scripts
```

The package contains source and prebuilt Client code; users do not need to build it. Zod is an explicit Host dependency. There are no install scripts.

## License

MIT; see [LICENSE](./LICENSE). The list artwork is original. DeepSeek Harness and Zod remain the property of their respective owners. This plugin is not endorsed by or affiliated with DeepSeek.
