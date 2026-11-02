# Lightweight issue workflow

Use the repository's existing GitHub Issues and Pull Requests; this workflow adds no service or subscription.

## Report a behavior

1. Search open issues for the same symptom before filing.
2. File one issue per behavior. Keep the title factual and the description concise: what happened, what was expected, and steps to reproduce when available.
3. Add only information needed to reproduce or triage. This repository is public: never attach saves, screenshots, logs, names, account details, credentials, tokens, private URLs, or other household/player data. Summarize observations in general terms and redact identifiers.
4. Mark uncertain causes as unknown. Separate observed facts from hypotheses and recommendations.
5. Include a short acceptance checklist for what would resolve the issue. Label future ideas as backlog recommendations and state when they are outside the current release.

## Make a focused change

1. Open a small PR and link the relevant issue. Use `Fixes #N` only when merging the PR should close that issue; otherwise use `Refs #N`.
2. Describe the behavior changed and evidence that supports it. Add regression coverage for the reported case when practical.
3. Do not include private configuration, player data, credentials, or production artifacts in commits or PR comments. Keep private validation details in an approved private location.
4. Close an issue only after its acceptance criteria are met and the fix is verified in the intended environment. Keep reports open when staging or production verification remains.

## Keep the queue useful

- Keep independent behaviors in separate issues so each can be prioritized and verified independently.
- Use labels already present in the repository; avoid creating a label taxonomy for a small project.
- Review open issues during normal maintenance. Close duplicates with a link to the canonical issue.
- No automation or paid tooling is required.
