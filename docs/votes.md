# votes

new votes last six hours and may close earlier when everyone votes. the server stores each new vote's deadline and rejects votes at or after that time. expired polls close during app refresh, vote creation, voting, or the daily check; results are recorded once.

polls created before this change keep their original 24-hour deadline. changing the default does not shorten a poll already in progress.

apply `scripts/build-vote-six-hours.cjs` to a current owner-provided private backend bundle. it changes only vote deadlines, enforcement and the vote announcement duration. `VOTES_BACKEND_SOURCE=/private/current.gs node --test tests/vote-six-hours.test.cjs` checks the full private source using in-memory storage and notification stubs. keep private source outside this repository.
