# Changelog

Player-visible changes are grouped by release, not by commit. Only verified production releases belong in dated release entries. Work merged afterward remains unreleased until separately verified.

Discord notices follow [the release update standard](docs/discord-updates.md). A changelog entry is not an instruction to post.

## Unreleased

No additional production release is asserted here. Collect the next verified batch before preparing a notice.

## 2026-11-03.1 — 3 November 2026

### Changed

- Life and legacy news excludes snapshot skill/career announcements and skill-objective completion notices. Saved skill/challenge progress remains available.
- Each detected event is sent individually when received. The daily game recap is removed and all fresh events in a sync are retained, including those beyond the previous eight-event limit. Patch-note batching is preserved.
- Snapshot comparison now detects revival and mutual divorce, with guards against missing relationship data. The backend also accepts scoped, timestamped life-event journals.

### Rollout and scope

The backend was published as production version 22 on the existing endpoint. Google staging passed 14 isolated runtime checks with 17 individual in-memory messages, zero external posts and zero persistent test writes. Local full-bundle/app checks passed 80 tests with two unrelated private-integration skips; seven synthetic collector checks passed under Python 3.7.

The new event collector and an unsigned update candidate are prepared but **not released**. Abduction, pre-term labour and incidents that begin and end between snapshots require that collector and working transport. Its automatic rollout still needs the existing trusted signing key. No new signing key or player game update is asserted, and no historical incident was announced.

**Announcement status:** held for the existing patch-note batch. No release notice was sent.

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
