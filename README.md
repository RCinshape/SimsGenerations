# Twenty-Gen Legacy

The app page. It holds no data and no keys: it talks to the group's Google app, and the private link part stays in the `#` of the link.

## development checks

run `npm ci --ignore-scripts`, then `npm test`. dependencies are for development only; the published app is still static html.

the tests exercise queued progress and the full page's checkbox handlers against a synthetic backend. they make no calls to the group's google app. synthetic players are named `qa-alpha` and `qa-beta`; do not substitute real player sessions or snapshots.

to inspect the request trace yourself, run `node tests/create-debug-fixture.cjs /tmp/sims-debug.html` and open the resulting file in a browser. its controls simulate offline requests and a changed shared session. it never sends game data to google.

the backend patch is in `gas/GoalEvents.gs`. it validates the authenticated actor and saved completion before recording a goal event. game completions use the same goal rules extracted from `index.html`, checked against the stored snapshot. receipt time and validated client time are kept separately. a client timestamp and source describe an accepted request; they do not prove who physically used the device.

to prepare an owner-provided private google bundle, run:

```sh
node scripts/build-backend-patch.cjs /private/original.gs /private/candidate.gs
BACKEND_SOURCE=/private/original.gs node --test tests/backend-goal-events.test.cjs
```

keep both bundles outside this public repository. the builder preserves private configuration and replaces only the progress/event implementation, shared goal rules and `whoami` version response. it checks that the result parses. tests of the full private bundle still use in-memory google storage, locks and notification stubs.

rollout requires a separate, verified staging deployment and a real browser run. update the client before the backend: old clients' untraceable tick events are then rejected with `update_required` until refreshed. inspect `whoami.syncVersion === 2` to verify the backend version. keep a copy of the previous deployment for rollback. local tests do not establish that staging or production has been updated.

browser storage is scoped by google deployment. legacy data is migrated only to its recorded original group and is preserved for recovery. cached progress without an explicit unsaved marker is kept but never automatically written over server progress.

progress writes use a revision check under the server lock. an older device cannot overwrite a newer save silently. the app preserves the unsaved copy, pauses queued activity, and offers a comparison before the player chooses saved progress or this device's changes.
