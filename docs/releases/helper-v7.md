# LegacySync inbox queue recovery fix — bundle v7

The Windows helper now flattens nested arrays and unwraps only the exact legacy `{value: [...], Count: N}` shape when `Count` matches the array length and the wrapper has no message ID of its own. It preserves valid message records, their IDs, and unknown fields, so the game's existing seen-ID handling continues to work. Nonmessage values and malformed wrappers are discarded. The 40-record cap applies after flattening.

The signed v7 release changes only `uploader.ps1`; all five game `.pyc` modules from v6 remain byte-for-byte unchanged. The uploader trace version is 6; the game mod remains version 6.

The PC helper installs the updated script during a sync, and the new helper is used on its next scheduled invocation. No Sims restart is required for this helper-side change. The unchanged game mod continues its own inbox poll.

Released to production on 2 November 2026. The original updater downloaded and installed v7 from staging in an isolated fixture; player configuration and all five game modules were preserved. Production file readback exactly matched the signed candidate. Rollout reaches each PC on its next successful sync, so publication does not mean every PC has installed it yet.
