# Life-event collector v8

Published 3 November 2026 through the existing signed update store. Backend production version 22 accepts its scoped life-event journal and preserves individual delivery. The release adds the read-only life collector and a final import to the existing collector. The other game modules and the v7 PC helper are unchanged.

The original signer matches the public verifier already installed. No replacement key or relaxed signature check was introduced. The canonical signing manifest is written as exact LF bytes on Windows.

Payload SHA-256: `059ce3c85713a09556bf1a373598eaf76a2696fc4becacf36adc4209381dc2a8`.

Verification:

- Seven synthetic collector tests passed under Python 3.7. The source hooks and explicit pre-term labour signal were checked against the installed game and childbirth-mod tuning.
- The existing compiled game verifier accepted the signed v8 bundle and rejected altered or incomplete payloads.
- The published v7 PC helper installed all exact payload files in an isolated archive, preserved configuration and the original backup, and rejected a bad signature without changing the installed archive.
- Google staging and production both accepted v8, rejected a tampered copy, retained the previous v7 update and read back the exact signed payload. No external release notice was sent.
- Public tests verify the signature with the existing public key, payload completeness and rejection of altered/incomplete files.

Publication is not confirmation that every PC has installed the update. Delivery follows successful sync; the code starts at the next game restart. Real game capture and every-player rollout remain unverified. The journal retains the latest 256 events per save/household. Existing transport outages, server deduplication retention and external-delivery failure behavior still bound delivery; the release does not replay incidents that were never captured.

Private keys, account configuration, player data and deployment receipts remain outside the repository.
