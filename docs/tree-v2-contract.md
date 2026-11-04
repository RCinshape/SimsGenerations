# Family tree v2: shared contract (all agents follow this exactly)

## Game data that exists today
`fam__<sn>.json` (Drive, written by `mergeFamily_` in Api.gs from game snapshots): `{ sims: { "<simId>": {f,l,a,g,p:[parentIds],c:[childIds],s:spouseId,ps:[partnerIds ever seen],h:householdId,t:lastSeenMs, occ?:[...] } } }`.
Sim ids are digit strings (up to 24 digits). Never convert to Number.

## New game data (collector v10, task MOD)
Each sim in a snapshot may carry `rels: [{id:"<otherSimId>", st:"married|engaged|dating|divorced|ex|widowed"}]` (only romantic statuses, from relationship bits) and `adopted: true` on a child the game marks as adopted. Snapshot field `relsVersion: 1`.
The backend must keep these per sim in fam data as `r: {"<otherId>": "<st>"}` and `ad: true`.

## API (backend task TREEAPI; page task UI)
All through the existing authenticated `api(path, body)`; errors as `{s, d:{error}}` like other routes.

### `tree` — read (any group member may read any member's tree; testers isolated like `live_`)
Request `{owner: "<player name>"}` → `{ owner, rev, sims, parents, partners, friends, heirs, hidden, canEdit }`
- `sims`: `{ "<id>": { id, first, last, gender, age, kind:"person"|"pet", species, life:"alive"|"dead"|"ghost", cause, occults:[], traits:[], asp, inHousehold:bool, src:"game"|"manual", edited:[fieldNames], gameValues:{field:value for edited fields}, linkedFrom?:{owner, simId} } }`
- `parents`: `[{ id, child, parent, type:"birth"|"adopted"|"step"|"unknown", src:"game"|"owner" }]`
- `partners`: `[{ id, a, b, status:"married"|"engaged"|"dating"|"ex"|"divorced"|"widowed"|"coparent"|"unknown", src:"game"|"owner"|"inferred" }]`
  - inferred rules (only when the game gives no status): current spouse → married; in `ps` but not current spouse, and not in `r` → `ex` ONLY if the game reported them as spouse before (ps), otherwise two sims who share a child and nothing else → `coparent`. Dead spouse with living partner → `widowed`.
- `friends`: `[{ id, a, b, src }]` (owner-made only for now)
- `heirs`: `{ "<gen 1..20>": simId }` from the player's challenge progress (`gens[n].heirSimId`)
- `hidden`: `[simId]`
- `canEdit`: true only for the owner (and not across tester boundary)
- Link `id`s are stable strings: parent `p:<parent>:<child>`, partner `m:<lowId>:<highId>`, friend `f:<lowId>:<highId>`.

### `tree_edit` — write (owner only, checked on the server; 403 `not_owner`)
Request `{owner, rev, ops:[...]}` → `{ok:true, rev}` or 409 `{error:"tree_conflict", tree:<full tree as above>}` when `rev` is stale. Ops apply atomically under the lock.
- `{op:"sim_add", sim:{first,last?,gender?,age?,kind?,species?,life?,cause?,occults?,traits?,asp?,notes?}}` → server assigns id `m<random>` (manual). Response includes `added:[id]`.
- `{op:"sim_set", id, fields:{...}}` → owner override per field (game value kept underneath).
- `{op:"sim_reset", id, field}` → drop the override ("use game value").
- `{op:"sim_hide", id, hidden:bool}`; `{op:"sim_delete", id}` (manual sims only; removes their owner links too).
- `{op:"link_add", kind:"parent", child, parent, type}` / `{op:"link_add", kind:"partner", a, b, status}` / `{op:"link_add", kind:"friend", a, b}`
- `{op:"link_set", id, status|type}` (override on a game link)
- `{op:"link_remove", id}` → for a game link: remembered exclusion (re-sync does not bring it back); for an owner link: deleted.
- `{op:"link_restore", id}` → removes an exclusion.
- `{op:"merge", manual:"m…", game:"<gameId>"}` → the manual sim's edits/links/portrait move onto the game sim.
Validation: ids exist in this tree; no self-parenting; no parent cycles (reject `cycle`); max 3 owner parents per child; strings cleaned (`clean_`), max 300 sims added per tree, max 2000 owner links.

Stored in `tree_edits__<sn>.json`: `{rev, sims:{id:{...manual sim}}, set:{id:{field:value}}, links:[{kind,...}], excluded:{linkId:true}, linkSet:{linkId:{status|type}}, hidden:{id:true}, merged:{manualId:gameId}}`.

## Rules every view uses (UI computes counts/layout only from these lists)
1. A sim's children = sims with a `parents` entry whose `parent` is that sim. Nothing through partners.
2. A family unit = one child's exact set of parents. Each unit gets its own connector.
3. Pets (`kind:"pet"`) never count as children in person counts.
4. A hidden sim is not drawn but its links stay.
