# Life and legacy news

Game news should report the story of the legacy: age-ups, births, pregnancies and pregnancy complications (including pre-term labour), marriages, divorces, deaths, revival or rescue from death, alien abductions, heir changes, generation transitions and other legacy milestones. Send each eligible event individually as soon as the game reports it and the backend receives it. Do not combine several events into a digest or apply the patch-note collection period, posting window or hourly ceiling.

Exclude skill levels, skill-maxing announcements and completion notices for skill objectives. Keep skill values and challenge progress for the app's normal tracking. A manual tick and an automatic game completion use the same news filter.

Only [patch notes](discord-updates.md) use the release batching policy. A code deployment does not authorize a test or catch-up message to the live channel.

## Implementation status

`gas/GoalEvents.gs` acknowledges validated skill-objective completions without inserting them into the social feed or sending a notification. It uses the catalog goal, so caller-supplied display text cannot change the decision. Other goal events retain their existing validation and delivery path.

`gas/GameNews.gs` replaces the private snapshot detector through `scripts/build-game-news.cjs`. It excludes skill/career messages, adds revival and mutual divorce detection, accepts scoped life-event journals, preserves occurrence times, removes the eight-event truncation and deduplicates each occurrence. The relay already sends each returned event individually; this path is preserved. The builder removes the daily game recap while preserving patch-note policy and existing money checks.

`sync/mod/twentygen_life.py` observes game events and writes a per-save/household journal through the existing collector. It captures death/revival, escaped death, age-ups, spouse changes, births, pregnancy, alien abduction and the installed childbirth mod's explicit pre-term labour buff. It does not infer an abduction from increased abduction odds or pre-term labour from spotting. It retains the latest 256 events across coalesced snapshots and restarts, and leaves unreadable journals untouched. Scope checks exclude other saves and households.

`scripts/build-life-update.py`, run with Python 3.7, prepares an unsigned v8 candidate from the reviewed v7 bundle. Existing game modules remain intact except for a final import added to the collector; the new addon is compiled separately. It rejects a changed collector baseline and never creates a signing key. The candidate requires the existing trusted signer before publication. Source, local tests and an unsigned candidate do not establish deployment or installation.

The collector depends on private game hooks. Its signatures and signal names were checked against the installed game code and childbirth tuning. Synthetic Python 3.7 tests cover capture, journal persistence, original return values, scope isolation and false positives; a real game runtime check remains required. A cold start establishes a baseline rather than announcing old incidents.

The relay's existing external-delivery failure behavior is unchanged: it records deduplication before attempting Discord delivery. This patch does not claim guaranteed delivery during a webhook outage. Journal and server deduplication are bounded, and notifications require working game transport and the new signed collector.

## Remaining acceptance checks

- Verify the backend changes on staging and confirm the intended deployment version before a production rollout.
- Receive several distinct life events in one sync and verify one delivery per event, in occurrence order. Repeated sync of the same events must not duplicate them.
- Cover age-up, marriage, divorce, birth, death, revival, abduction and pre-term labour with synthetic records. A missing Sim or spouse must not alone be interpreted as death or divorce.
- Sign the collector through the existing trusted process, validate the unchanged update verifier, and verify event capture and transport with the game runtime.
- Keep patch-note batching and its existing delivery record separate. Do not announce historical incidents as newly detected events.
- Verify staging with external notifications stubbed or directed only to an explicitly designated test destination. Report local, staging and live verification separately.
