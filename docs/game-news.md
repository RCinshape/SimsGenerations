# Life and legacy news

Game news should report the story of the legacy: age-ups, births, pregnancies and pregnancy complications (including pre-term labour), marriages, divorces, deaths, revival or rescue from death, alien abductions, heir changes, generation transitions and other legacy milestones. Send each eligible event individually as soon as the game reports it and the backend receives it. Do not combine several events into a digest or apply the patch-note collection period, posting window or hourly ceiling.

Exclude skill levels, skill-maxing announcements and completion notices for skill objectives. Keep skill values and challenge progress for the app's normal tracking. A manual tick and an automatic game completion use the same news filter.

Only [patch notes](discord-updates.md) use the release batching policy. A code deployment does not authorize a test or catch-up message to the live channel.

## Implementation status

`gas/GoalEvents.gs` acknowledges validated skill-objective completions without inserting them into the social feed or sending a notification. It uses the catalog goal, so caller-supplied display text cannot change the decision. Other goal events retain their existing validation and delivery path.

The public repository does not contain the source for the snapshot news detector, news sender, or current game collector. The signed update bundles contain compiled game modules. The goal filter alone therefore does not remove snapshot-derived skill messages, split aggregated game messages, or add missing life-event detection. Those changes require the current private backend and collector source, followed by staging verification; they are not yet implemented by this patch.

## Remaining acceptance checks

- Verify both news producers exclude skill announcements while saved skills and challenge progress remain intact.
- Receive several distinct life events in one sync and verify one delivery per event, in occurrence order. Repeated sync of the same events must not duplicate them.
- Cover age-up, marriage, divorce, birth, death, revival, abduction and pre-term labour with synthetic records. A missing Sim or spouse must not alone be interpreted as death or divorce.
- Preserve transient events that start and finish between snapshots, such as a death followed by revival. Snapshot comparison alone cannot recover these: verify collector event capture and transport with the game runtime.
- Keep patch-note batching and its existing delivery record separate. Do not announce historical incidents as newly detected events.
- Verify staging with external notifications stubbed or directed only to an explicitly designated test destination. Report local, staging and live verification separately.
