# Life events v2 and the Test profile: plan

Date: 4 November 2026. Owner request: report every Sims life event that matters, from every pack; add a Test profile that never reaches the girls.

This work does not touch the family engine and tree (PR #17, `feat/family-engine-v2`). It edits the game collector, the news part of the backend, and small parts of the app page.

## 0. Baseline (verified 4 November 2026, 14:50)

| Part | Where it lives | Verified as |
| --- | --- | --- |
| App and Health pages | GitHub Pages = repo `main` | sha256 of the live pages = repo files (index `516c4dba…`, health `3d678318…`) |
| Backend | Apps Script project, one bundle | live deployment **version 23** (3 Nov, 21:04); editor bundle sha256 `cd9514d8…`, kept privately as the edit baseline |
| Game collector | signed update **v8** in `updates/` | v6 game modules + `twentygen_life.pyc`; the collector sources for log/net/sync/partner/inbox compile to the same code as v8 |
| PC helper | `sync/LegacySync.ps1` | uploader version 6 inside v8 |

## 1. Events now

The collector (`twentygen_life.py`) and the backend (`gameNews_`) report: birth, pregnancy, pre-term labour (a childbirth mod's buff), age-up, marriage, divorce, death, revival, escaped death and alien abduction. Money jumps of §20,000 or more get the Plumbob Police.

**Bugs found while scoping:**
- B1. Trait names in the snapshot are all `TuningBlueprint`. `_name()` takes the class name of a tuning *instance*. Fix: read `__name__` of the object first, as `twentygen_life._name` already does.
- B2. Loading an *older* save of the same slot posts "X is alive again" (a false revival). The snapshot diff must ignore a snapshot whose game time is earlier than the last accepted one, and revival must come from the journal hook, not the diff.

## 2. Event catalogue

The detectors are **generic**: one hook covers an event in every pack that uses the same game system. A pack that is not installed simply never fires. Tuning names marked *(probe)* must be confirmed with the probe (section 3) before they are trusted.

### 2.1 Family and life stages (base game unless noted)

| Event | Kind | Detector | Packs |
| --- | --- | --- | --- |
| Birth, with the parents | `baby` (exists) | OffspringCreated hook + diff | all |
| Twins / triplets / quads | `twins` | 2–4 births to the same parent in one journal window (10 sim minutes) | all |
| Adoption | `adopt` | ChildAdopted hook (today it is reported as a birth) | base |
| Pregnancy, alien pregnancy | `pregnancy` (exists), `alienbaby` | pregnancy hook; the other parent is an alien | GTW |
| Pre-term labour | `preterm` (exists) | mod buff | childbirth mod |
| Age-up | `ageup` (exists) | AgedUp | all |
| Became an elder | part of `ageup` | text change only | base |
| Moved into / out of the household | `movein`, `moveout` | household membership diff, Sims with family history only | base |
| Household moved house / world | `moved` | snapshot `zone` + world change | base |
| Pet or horse joined the family | `pet` | new household member of a non-human species *(needs `species` in the snapshot)* | Cats & Dogs, Horse Ranch |
| Pet born | `petbaby` | OffspringCreated with a pet parent | Cats & Dogs, Horse Ranch |

### 2.2 Love

| Event | Kind | Detector | Packs |
| --- | --- | --- | --- |
| Engaged | `engaged` | relationship bit added, name contains `Engaged` *(probe)* | base |
| Married (exists), divorced (exists) | `marry`, `divorce` | SpouseEvent | base |
| Became a couple (steady) | `couple` | bit `romantic-Significant_Other` / `GettingMarried`… *(probe)* | base, Lovestruck |
| Broke up | `breakup` | that bit removed while both alive | base, Lovestruck |
| Caught cheating | `cheat` | Lovestruck "betrayed" sentiment / bit *(probe)* | Lovestruck |
| Widowed | text on `death` | the dead Sim's spouse is alive | base |

No WooHoo or "first time" news (house rule: mature themes, nothing explicit).

### 2.3 Death and the supernatural

| Event | Kind | Detector | Packs |
| --- | --- | --- | --- |
| Death **with the cause** | `death` + `cause` | `si.death_type` name → British cause line ("died of laughter", "electrocuted", "eaten by a cow plant"…); unknown → plain death | all packs that add deaths |
| Became a ghost | part of `death` | death type + ghost occult | base |
| Revived / escaped death | `revive`, `rescue` (exist) | death tracker hooks | base, Life & Death |
| Inheritance received | `inherit` | funds jump right after a family death in the same window *(Life & Death will; probe the will event)* | Life & Death |
| **Occult change** | `occult` | `occults` diff in the snapshot: vampire, spellcaster, werewolf, mermaid, alien, plant Sim, fairy, ghost, servo/robot | GTW, Vampires, Realm of Magic, Werewolves, Island Living, StrangerVille, Enchanted by Nature, Discover University |
| Alien abduction | `abduct` (exists) | buff / interaction | GTW |

**Rule breaker:** the house rules say *never* vampires, aliens, plant Sims or royalty. If an **heir** turns into one of those, the post adds a Plumbob Police note ("That's against the rules, madam").

### 2.4 Milestones (base game since the Growing Together update)

| Event | Kind | Detector |
| --- | --- | --- |
| First steps, first words, potty trained, first day of school, first crush, first kiss, first love, first heartbreak, graduated, first job, retired, got married, became a grandparent | `milestone` + `name` | milestone tracker "completed" hook *(probe the method and the milestone names)* |

Only a whitelist of milestones is posted; the rest are kept out of Discord.

### 2.5 Achievements of a life (still no skills or careers)

| Event | Kind | Detector | Packs |
| --- | --- | --- | --- |
| Aspiration completed | `aspiration` | `asp.done` false → true in the snapshot (already collected) | base |
| University degree | `degree` | trait gained, name contains `Degree` / graduation milestone *(probe)* | Discover University |
| High-school graduation, prom king/queen | `graduate`, `prom` | milestone / trait *(probe)* | High School Years |
| Became famous (4–5 stars) | `famous` | celebrity fame statistic level crosses 4 *(probe)* | Get Famous |
| Opened a business | `business` | Businesses & Hobbies business opened *(probe)* | B&H |
| Crowned / royal title | `royal` | Royalty & Legacy title trait or bit *(probe)*; also triggers the rule-breaker note | Royalty & Legacy |
| Fired, retired | — | **not posted**: careers stay out of the news (owner decision of 3 Nov) |

### 2.6 Disasters and chaos (light-hearted)

| Event | Kind | Detector | Packs |
| --- | --- | --- | --- |
| House fire | `fire` | Sim gets the "on fire" buff *(probe)* | base |
| Struck by lightning | `lightning` | buff *(probe)* | Seasons |
| Burglary | `burgled` | burglar visit outcome *(probe)* | base |
| Evicted | `evicted` | For Rent eviction *(probe)* | For Rent |

### 2.7 Not in scope

Skills, careers, holidays, festivals, clubs, fashion, gardening, fishing and collecting. The house rules rule out several of these anyway. Events of Sims outside the legacy family are ignored unless they involve a family member (for example a spouse).

## 3. The probe (how unknown names get verified)

The collector gets a **probe mode**. It is off by default and switched on per PC by a file `LegacySync/probe.on`. In probe mode it writes to `LegacySync/probe.log`, never to the server:

- every TestEvent name it sees, with a count;
- every buff, trait, relationship bit and milestone that is added to a household Sim, by tuning name and guid;
- the death type name on every death.

On the owner's PC (Emmy's save copy, all packs and mods) I play scripted scenes with cheats (`sims.add_buff`, `traits.equip_trait`, `relationship.add_bit`, `death.toggle`, age-up, engage/marry) and read the probe log. Each *(probe)* name in section 2 is then confirmed or replaced **before** that detector is enabled. A detector whose name is not confirmed ships switched off.

## 4. Test profile

**What it is:** a player named **Test** for the owner's own PC and saves. It behaves like any player in the app and on the Health page, but nothing it does reaches the girls.

**Group features (they all exist today):** Discord posts, game news, the social feed, reactions, votes, chaos button, in-game messages (inbox), shared screenshots and the family trees.

| Feature | With Test |
| --- | --- |
| Discord (feed webhook) | **blocked**: every `feed_()` for Test is dropped and logged as `test: not posted` on the Health page |
| Game news, ticks, posts, heirs | saved in Test's own data; **not** in the girls' feed |
| Reactions | Test can react only to Test's posts; nobody else is notified |
| Votes | Test can make and vote on votes that only Test can see |
| Chaos | Test's switch exists, but Test can neither send to nor receive from a girl; Test can send chaos **to itself** (to test the in-game message) |
| In-game messages | only from Test to Test |
| Screenshots | **not** posted to Discord; kept as "would post" on the Health page |
| Neighbourhood, trees | the girls do **not** see Test; Test sees everyone, read-only |
| Alerts (host webhook) | still sent, marked `[TEST]` |

**How:** one backend helper `isTest_(name)` (the player list `test_players` in script properties, default `['Test']`), and a guard in each path above. The app shows a yellow "TEST PROFILE: nothing goes to the girls" bar when the player is Test. Test is added with the existing party-code join; the owner's PC then installs with Test's installer.

## 5. Tasks

Small tasks go to the Sonnet model; I review every diff, run the tests and fix. I alone deploy.

| # | Task | Owner | Output |
| --- | --- | --- | --- |
| T1 | Collector: fix B1; add `species`; probe mode; new hooks (relationship bits, milestones, death cause, adoption kind, twins window) with a whitelist that can be switched off per detector | Sonnet | `sync/mod/*.py` + Python 3.7 synthetic tests |
| T2 | Backend news: new kinds, British texts, snapshot diffs (occult, aspiration, pet, move in/out, moved, twins), rule-breaker note, fix B2 | Sonnet | `News.gs`/`Voice.gs` + simulator tests |
| T3 | Backend Test profile: `isTest_`, guards on feed, inbox, chaos, votes, reactions, shots, live view filtering, Health marker | Sonnet | `Notify/Social/Api/Relay/Health.gs` + simulator tests |
| T4 | App page: Test banner; hide Test from the girls; disable interaction panels for Test | Sonnet | `index.html` + browser test |
| T5 | Review, integration, full test run, security tests | me | — |
| T6 | Probe session on the owner's PC; confirm names; enable confirmed detectors | me | probe report |
| T7 | Deploy: backend new version; app page; signed collector v9 through the existing update path; add the Test player | me | release record |

## 6. Release checks

- All existing tests still pass (simulator, attack tests, collector tests).
- Every new kind: one synthetic test that posts it, one that must **not** post it (a false positive), and no duplicates on a repeated upload.
- Test profile: a test that walks every group feature and checks that nothing reaches the girls' feed, inbox or views.
- After deployment: the live endpoint answers; Test's events show on the Health page as "not posted"; a girl's account does not see Test.
