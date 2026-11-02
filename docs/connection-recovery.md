# connection recovery

the app uses one foreground poll per account and session. temporary failures slow retries with bounded backoff; returning to the tab or restoring the network resumes recovery. queued changes retain their player identity. an expired login or a progress conflict still requires the player to act.

a save whose response was lost can be acknowledged without another write only when the saved record and the exact retry contain the same canonical data, including timestamps. a different save, future revision, or representation that would lose data still produces a conflict. event retries retain their existing ids; deduplication is limited to the server's retained feed history.

if the browser cannot write a recovery copy, it warns the player to keep the tab open until saving succeeds. this does not block online saving. shared storage remains a fallback when tab storage is unavailable, and another tab using the same account can overwrite that fallback.

## reading health

- app activity means a successful authenticated browser poll within 90 seconds. it does not prove someone is at the pc or that the game is running. missing cache entries mean unknown.
- game/helper contact and changed saves are separate observations. an unchanged helper can be quiet while it is working.
- game, helper, and release bundle versions are separate numbers. all displayed client versions are last reported values.
- the comparison refreshes every 30 seconds while visible. older details have their own snapshot age. failed refreshes retain the last snapshot and mark it stale.
- a timed-out administrative action may already have completed. check the result before repeating it. key changes, notifications, uploads, login and other administrative actions are never retried automatically.

## helper release boundary

the checked-in helper source checks for updates even when the game snapshot has not changed, and retries a failed update on a later scheduled run. it installs only an update verified with the existing signing key and records the installed bundle after success.

this source change is not a signed release. the deployed v7 bundle remains unchanged until the existing private release process packages and signs a higher version, tests it with the original updater, and publishes it through the existing relay. changing the fallback uploader alone does not replace a valid signed uploader already served by the backend. do not rotate keys or bypass signature checks to complete a release.

## checks

windows ci runs the javascript suite, the generated installer powershell checks, and the helper tests using windows powershell. local private-backend checks can also set `BACKEND_SOURCE`, `PRESENCE_BACKEND_SOURCE`, and `IDEMPOTENCE_BACKEND_SOURCE` to the appropriate owner-provided baseline. the incremental presence and idempotence builders reject reapplication and preserve unrelated backend source.
