# Changelog

## 1.3.1 — 2026-11-06

First public npm release of the task-list plugin.

- Browse conversations across workspaces in one dialog and jump to a conversation with one click.
- Keep completed conversations in the list instead of hiding them when activity ends.
- Show green only for confirmed successful completions that are both new since page activation and unread.
- Retain older or already-viewed completions as neutral completed rows.
- Distinguish running, queued, waiting, failed, stopped and unconfirmed results.
- Read visible historical outcomes lazily, with at most four concurrent, deduplicated reads.
- Include English and Chinese UI text, original artwork, an MIT license and explicit runtime dependency metadata.

The public release follows the locally tested 1.3.0 implementation. Data and state tests do not replace browser end-to-end or cross-version visual testing.
