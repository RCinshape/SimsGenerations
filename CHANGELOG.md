# Changelog

Player-visible changes are grouped by release, not by commit. Only verified production releases belong in dated release entries. Work merged afterward remains unreleased until separately verified.

Discord notices follow [the release update standard](docs/discord-updates.md). A changelog entry is not an instruction to post.

## Unreleased

No additional production release is asserted here. Collect the next verified batch before preparing a notice.

## 2026-11-04.2 — 4 November 2026

### Added

- New family tree page in the style of the reference: the chosen sim in the middle, parents above, partners stacked with a status symbol (💍 married, ❤️ dating, 💔 ex or divorced, 🖤 widowed, 🤝 co-parent), children grouped by their exact parents, "Open subtree" on a partner, heir line, search, a sim card side panel, an edit mode with dotted outlines, Add parent / partner / child / friend / pet pickers, "+ Add Sim", hide, undo and "use game value". A floating 🌳 bubble on every page opens the tree in a new tab.
- Owner edits are stored on top of the game data and survive every sync; only the tree's owner can edit (checked on the server).
- The game mod now reports romantic statuses (married, engaged, dating, divorced, ex, widowed) and adoption, so exes and widows come from the game instead of guesses.
- The PC helper reads sim pictures from the game's own thumbnail cache and uploads them; a picture a player uploaded herself is never replaced.

### Improved

- Faster app: the page shows the last data at once, the server keeps one ready-made answer, and a 5-minute timer keeps it awake.

### Rollout and scope

Backend production version 25. App pages from `main`. Signed collector/helper update v10 published to everyone; it arrives at the next sync and starts at the next game restart. Romantic statuses and game pictures appear after that. Not yet checked in a real game.

**Announcement status:** held. The current instruction is not to post.

## 2026-11-04.1 — 4 November 2026

### Added

- More life news from the game, posted one by one as before: occult changes (vampire, werewolf, spellcaster, mermaid, fairy and others), completed aspirations, new pets and horses, Sims moving in or out, the family moving house, engagements, new couples, break-ups, best friends and sworn enemies, child and life milestones, twins and triplets, adoption, and the cause of a death with a widow or widower line. An heir who becomes a vampire, alien or plant Sim gets a rule-breaker note.
- A Test profile for the host's own PC. Nothing it does reaches the girls' Discord, app or games; its news goes to the host's alert channel.

### Fixed

- Trait names in game snapshots were all reported as "TuningBlueprint".
- Loading an older save no longer posts false news (for example "X is alive again"); the check uses game time.
- Test-player isolation: reactions, votes and in-game messages no longer cross between the Test profile and the girls.

### Rollout and scope

Backend production version 24 (from version 23). App page: Test profile banner. Signed collector update v9 (game modules sync and life changed; net, log, partner, inbox and PC helper unchanged from v8) was published to the test channel and then to everyone; it arrives on a successful sync and starts at the next game restart. Installation on each PC is not asserted. New relationship and milestone detectors use game names that still need confirmation on a real game (probe mode, see `docs/life-events-v2-plan.md`); an unconfirmed name simply does not fire.

Local checks: news 108, Test profile 67, security 87, social 35, collector 34 (Python 3.7), app 131. No real-game run yet.

**Announcement status:** held. The current instruction is not to post.

## 2026-11-03.1 — 3 November 2026

### Changed

- Life and legacy news excludes snapshot skill/career announcements and skill-objective completion notices. Saved skill/challenge progress remains available.
- Each detected event is sent individually when received. The daily game recap is removed and all fresh events in a sync are retained, including those beyond the previous eight-event limit. Patch-note batching is preserved.
- Snapshot comparison now detects revival and mutual divorce, with guards against missing relationship data. The backend also accepts scoped, timestamped life-event journals.

### Rollout and scope

The backend was published as production version 22 on the existing endpoint. Google staging passed 14 isolated runtime checks with 17 individual in-memory messages, zero external posts and zero persistent test writes. Local full-bundle/app checks passed 80 tests with two unrelated private-integration skips; seven synthetic collector checks passed under Python 3.7.

Signed collector update v8 was subsequently published through the existing update channel using the original trusted signing key. Google staging and production verified its signature and exact payload readback; the v7 rollback copies were retained. The existing game verifier and published PC helper accepted the update in isolated fixtures and rejected tampering. See the [collector release record](docs/releases/life-v8.md).

Abduction, pre-term labour and incidents that begin and end between snapshots require the new collector and working transport. Each PC receives it on successful sync and activates it at the next game restart; installation for every player and live game capture are not asserted. No new signing key was created and no historical incident was announced.

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
