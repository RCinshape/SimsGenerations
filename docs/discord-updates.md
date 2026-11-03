# Discord release updates

This is the standard for player-facing release notices. Keep them professional, useful and infrequent. Use the existing bot and infrastructure; no extra paid service is needed.

This policy covers patch notes only. [Life and legacy news](game-news.md) is sent as one message per event as soon as it is received, without this release collection period, hourly cooldown or posting window. Skill levels and skill-maxing objectives are excluded from game news.

**Current instruction: do not post again.** Keep notices as drafts until the owner explicitly resumes posting. Do not send, edit, delete or test Discord messages to announce this policy. Updating documentation, merging a PR or deploying code is not authorization to send a message.

## One release, one notice

- Collect changes in [the changelog](../CHANGELOG.md). Combine related fixes across PRs into release entries. One notice may cover several releases; list their IDs and never announce the same release twice.
- Routine changes wait for a meaningful batch. Do not post for every commit, test, ticket, deployment step or background sync.
- Send at most one routine notice per destination in any rolling 60-minute period, across all releases and senders. This is a ceiling, not an hourly posting schedule. If nothing useful changed, stay silent.
- Open a batch when the first verified production change is ready; collect further changes for 60 minutes. New changes join that batch without restarting its clock. Send only after both this collection period and the destination's last-send cooldown have elapsed, and only inside the posting window. Overnight changes form one batch for the next window. Longer batching is welcome when changes are minor; do not empty a backlog as a series of hourly messages.
- Documentation, internal refactoring, staging checks and unchanged status do not need a player announcement.
- Do not repeat an already announced change or send a catch-up notice about this standard.
- Keep game-story messages and operational logs separate from release notices. This policy does not change existing game-event or money-alert behavior.

## What players should see

Use a consistent title, release ID (or IDs) and date, followed by two to four short bullets about the effect on play. Aim for 80–150 words; stay below 1,500 characters including links. Use plain English, calm wording and sentence case. No celebratory filler, teasing accusations, technical dump or maintenance checklist. Be warm and matter-of-fact; avoid forced banter, exaggerated claims and pretending the bot is a person. Do not send DMs, ask for reactions, request acknowledgements or chase players who do not respond.

Include only verified changes that reached the stated environment. Say "published; arriving through normal sync" when delivery is gradual. Say "installed for everyone" only when there is evidence for every relevant device. Keep app, backend, helper and game-mod versions distinct in the internal release record; players usually need only the release ID.

The goal is no player work. The host handles routine checks and recovery privately. Say "No action needed" only when verified for the notice's scope. Do not casually ask everyone to refresh, reinstall, restart, check settings or report back. If an unavoidable player action remains, explain only the necessary step, who it affects and when; first establish whether the host can resolve it. Do not hide a real limitation or promise full automation before it exists.

Mention unchanged behavior only when it prevents a likely misunderstanding. Do not name an affected player, expose their household, blame a person or imply that a balance change proves cheating.

### Standard notice template

> **Twenty-Gen Legacy — Release YYYY-MM-DD.N**
> DD Month YYYY
>
> **Fixed**
> - [Player-visible improvement.]
> - [Related improvement in the same release.]
>
> **Rollout:** [Verified availability and how the update arrives.]
>
> [Only if necessary: one brief known limitation or unavoidable action.]
>
> [Optional: one changelog link when it adds useful detail.]

Use "Improved" or "Added" instead of "Fixed" when appropriate; omit empty sections. Replace every placeholder before sending. Do not send the template or a test message to the live channel. Avoid attachments and link previews unless they help explain an essential change.

## Quiet delivery

- Use the release bot identity, never a personal account as a fallback.
- No @everyone, @here, role or user pings. Set the webhook payload's `allowed_mentions` to `{"parse":[]}`; do not rely on text alone to prevent mentions.
- Send routine notices with Discord's `SUPPRESS_NOTIFICATIONS` flag (`4096`) and `tts: false`, as well as empty allowed mentions. [Discord documents](https://docs.discord.com/developers/resources/message#message-flags) that this suppresses push and desktop notifications; a badge may still appear. [Webhook delivery supports this flag](https://docs.discord.com/developers/resources/webhook#execute-webhook). Keep the hourly limit even when notifications are suppressed.
- Routine notices may be sent only between 09:00 and 20:00 in `Europe/London`, including daylight-saving changes. Hold overnight batches until the next window. This is a default posting window, not an exact-time guarantee.
- An active outage, credible risk of lost progress or other time-sensitive player action may justify a concise incident notice outside the routine limit/window, when messaging is authorized. A normal fix is not an incident.
- For incidents, send only meaningful changes: the initial impact/action and resolution, with an intermediate update only if the impact or required action changes. Do not post periodic "still investigating" messages.
- Keep support discussion and technical investigation in tickets or host conversations. Do not turn the release channel into a live work log.

## Prevent duplicate sends

Before any authorized delivery, check the release entry and the private delivery record for the destination. A prior human-account announcement also counts: a new bot identity is not a reason to repost.

Use stable release IDs such as `2026-11-02.1`. Treat each release ID plus destination as a unique delivery key. Keep a destination-wide send lock and last-send time as well, so different releases or operators cannot bypass the hourly limit. A batch has one Discord receipt shared by all covered release IDs; mark every covered ID as announced. Repeated jobs, reconnects and retries must reuse these records rather than create a new notice.

Keep a small private record using existing storage:

| Field | Purpose |
| --- | --- |
| Release ID and destination | Unique delivery key |
| Draft text and content hash | Exact notice being considered |
| State | Draft, sending, sent, uncertain, held or cancelled |
| Started/sent time in UTC | Delivery history |
| Discord message ID or receipt | Evidence of delivery |
| Correction time/reason | History without reposting |

Record `sending` before the request, then the returned receipt and `sent` after success. Request a message receipt (`wait=true` for a webhook sender) and verify the returned content. A timeout, lost response or crash after sending means `uncertain`, not permission to retry. Inspect the destination or recover the receipt before another attempt. If the result cannot be established, hold for the host; do not guess. Respect rate limits without creating a parallel resend.

A material correction should normally edit the existing message, only when authorized, with a short dated correction note. Do not silently reverse earlier advice. A separate follow-up is reserved for a new urgent impact or necessary player action that an edit would fail to communicate; link the original. No extra "correction posted" message.

## Source of truth and privacy

- The changelog is the release summary. Detailed reproduction, tests, rollback and rollout evidence belong in linked tickets or release records.
- A merged PR, published source and verified production rollout are different states. Keep unreleased work clearly separate.
- Store webhook URLs, tokens, destination IDs, delivery receipts and private rollout evidence outside this public repository. Never put credentials in a changelog, issue, screenshot or example payload.
- Do not track who reads a notice, collect engagement analytics or monitor players' presence for release communication. Delivery receipts are enough.
- Use synthetic examples in public docs. Do not publish player saves, personal details, account/session links or private telemetry.
- Public changelog entries may state that a release was already announced without publishing the private Discord receipt.
- Documentation is not an implemented queue, lock, scheduler or deduplication service. Until those safeguards exist in a sender, the host must apply them using the release record; agents must not claim automatic enforcement.

Hands-off rollout and bot delivery work remains tracked in [issue #7](https://github.com/RCinshape/SimsGenerations/issues/7). This standard does not close that implementation work or authorize a new post.

## References and chosen approach

These are design references, not services to install or claims about their posting frequency:

- [PatchBot's official FAQ](https://patchbot.io/faq) describes delivering game patch notes and tracking its own delivered messages. Borrow the release-first purpose and delivery record; keep our existing bot rather than adding another integration.
- [Grafana's notification grouping](https://grafana.com/docs/grafana/latest/alerting/fundamentals/notifications/group-alert-notifications/) separates the initial collection wait from the interval between later notifications. Borrow that batching model with our own 60-minute policy. Do not copy its recurring reminders: an unchanged release gets no reminder here.
- [Discord's notification guide](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101) shows that users can receive notifications for every channel message. No mentions does not guarantee a silent message, so reducing message count remains essential. Do not make players change their notification settings to compensate for bot noise.

Our standard is a short release digest: what improved, how it reaches players and an action only when unavoidable. Quiet by default, no conversational filler and no requests for engagement.
