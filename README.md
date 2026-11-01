# Twenty-Gen Legacy

The app page. It holds no data and no keys: it talks to the group's Google app, and the private link part stays in the `#` of the link.

## development checks

run `npm ci --ignore-scripts`, then `npm test`. dependencies are for development only; the published app is still static html.

the tests exercise queued progress and the full page's checkbox handlers against a synthetic backend. they make no calls to the group's google app. synthetic players are named `qa-alpha` and `qa-beta`; do not substitute real player sessions or snapshots.

to inspect the request trace yourself, run `node tests/create-debug-fixture.cjs /tmp/sims-debug.html` and open the resulting file in a browser. its controls simulate offline requests and a changed shared session. it never sends game data to google.

event metadata (`at`, `actor`, `goal`, and `source`) is sent by the client. the current google backend must be updated separately before those fields can be retained in the server's activity history. do not treat the client tests as proof that the deployed backend retains them.
