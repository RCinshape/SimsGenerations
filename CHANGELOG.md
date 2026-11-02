# Changelog

Player-visible changes are grouped by release, not by commit. Only verified production releases belong in dated release entries. Work merged afterward remains unreleased until separately verified.

Discord notices follow [the release update standard](docs/discord-updates.md). A changelog entry is not an instruction to post.

## Unreleased

No additional production release is asserted here. Collect the next verified batch before preparing a notice.

## 2026-11-02.1 — 2 November 2026

### Fixed

- Goal tracking now checks saved progress and the matching game snapshot before accepting completion events. Older saves cannot silently replace newer progress.
- Separate browser tabs preserve their own pending changes when reloaded.
- The PC sync helper handles an older inbox format that could leave chaos messages queued.

### Rollout and scope

The goal-sync backend was published as version 19. Signed PC update bundle v7 was published through the existing update channel; it arrives on a successful sync and runs on the following helper invocation. Publication does not confirm installation on every PC. The bundle changes the helper only; game modules are unchanged from v6. See the [helper release record](docs/releases/helper-v7.md).

Money-alert behavior is unchanged. Fully hands-off recovery for every older browser or conflicting edit remains [follow-up work](https://github.com/RCinshape/SimsGenerations/issues/7).

Related changes: [#1](https://github.com/RCinshape/SimsGenerations/pull/1), [#5](https://github.com/RCinshape/SimsGenerations/pull/5), [#6](https://github.com/RCinshape/SimsGenerations/pull/6).

**Announcement status:** already announced. Do not send another notice for this release. Private delivery receipts are kept outside the repository.
