# family engine release

this feature needs a coordinated backend, frontend, and signed collector rollout. merging the frontend before the backend routes exist will break family reads. the collector candidate is unsigned and must not replace the signed update feed.

1. capture the current production and isolated staging sources and deployment versions. rebuild from those current sources with `build-family-capture-backend.cjs`, then `build-family-backend.cjs`. keep compiled bundles private.
2. stage with existing execution identity, access, roster, storage, and notification settings. verify unknown routes, owner authorization, roster isolation, revisions, replay rejection, source selection, manual overlays, portrait isolation, and cleanup against the actual service. use disposable test actors only.
3. run `family_audit` read-only for all visible players. investigate existing parent conflicts without silently rewriting historical data. legacy records cannot establish verified save identity.
4. build the collector with python 3.7 using `build-family-update.py`. use the existing trusted signing process, then validate with the original updater in staging. preserve every other module and signature verification. do not generate a new key.
5. test a real game capture, subsequent automatic update, complete parent correction, partial scan, and offline replay. a local collector stream is not a verified save lineage; owners choose their source explicitly.
6. deploy the tested backend to the existing production endpoint, then merge the single reviewed frontend commit and verify hosting. publish only the validated signed collector. read back immutable backend source and active versions.
7. verify each player's read-only tree, owner editing, separate-tab bubble, manual portrait upload, reload, and mobile layout. retain previous backend version and frontend commit for rollback. no notification or privacy changes are part of this release.

automatic portrait extraction is not implemented or proven. manual upload remains available, and later imports must preserve it. native game runtime and live service checks are separate from synthetic browser and node/python tests.
