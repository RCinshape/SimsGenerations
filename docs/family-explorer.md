# family explorer

open **explore family tree** from a player's family panel. the explorer shows reported parents, children and partners, with pan, zoom, fit, a searchable family list and individual details. family layout is separate from challenge generations. unknown relatives, omitted records and inconsistent relationships are labelled; the view does not infer divorce or widowhood from co-parent or death data.

portraits are manual uploads. the browser converts jpeg, png or webp files to a small jpeg before upload. images stay in the existing authenticated group; each player can edit only their own sims. conditional versions prevent stale edits from replacing another device's newer portrait. repeating an identical upload does not create another image write. a timed-out write is not automatically repeated.

the view expands up to 500 known records and 1,000 referenced nodes. larger or cyclic families use approximate positions and may have crossing lines. photo reads are limited to two concurrent requests, a small pending queue and 60 reads per five minutes per browser/player/group. this keeps photo browsing from filling the app's request allowance.

prepare the private backend from the current owner-provided bundle with `node scripts/build-portrait-backend.cjs /private/current.gs /private/candidate.gs`. the builder preserves other source and rejects reapplication. `PORTRAITS_BACKEND_SOURCE=/private/current.gs npm test` adds private baseline checks; public windows ci uses synthetic fixtures only. source tests do not establish a deployed backend or native browser image decoding.
