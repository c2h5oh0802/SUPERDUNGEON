# Huntress Progression v2: reproducible controls

These measurements answer two limited questions: how much leveling the generated chapter can supply, and whether the rework changes the talent-free Huntress kit. They are not human playtests, estimates of fun, or campaign survival evidence.

## Source identity and reproduction

The immutable baseline is the sibling `superdungeon-healing` checkout. Candidate source is this checkout. Each result has a SHA-256 sidecar covering every production TypeScript file and the shared `tests/helpers.ts` fixture. The runner hashes before/after bundling and aborts if either input changes during bundling. It executes the captured bundle in memory, without changing production files or installing packages. `tooling-sha256.json` identifies the delivered harness/runner/validator.

From this checkout, using its existing dependencies:

```sh
node scripts/huntress-calibration/run-calibration.mjs ../superdungeon-healing docs/huntress-baselines/before.json
node scripts/huntress-calibration/run-calibration.mjs . docs/huntress-baselines/after.json
node scripts/huntress-calibration/compare-results.mjs docs/huntress-baselines/before.json docs/huntress-baselines/after.json docs/huntress-baselines/comparison.json
npx eslint scripts/huntress-calibration
```

An alternative baseline location may be supplied as the first argument. `SEEDS=FLOW1,FLOW2` can narrow the census, but the delivered results use the complete default 20-seed set: FLOW1, FLOW2, LIVING1, HUNTRESS-01 through HUNTRESS-17.

## XP supply census

For each generated five-floor run, the harness obtains every enemy's real `killXp` including veteran multipliers. It credits kills through production `gainXp`, resolves the first offered talent immediately, and carries progression with the normal `nextFloor`/`createFloorWorld` APIs.

- Full supply: all generated enemies on all five floors
- 70% exposure: a deterministic shuffled subset of `ceil(0.7 × enemy count)` on each exploration floor, then all arena enemies
- 30% exposure: equivalent `ceil(0.3 × enemy count)` subset, then all arena enemies

The shuffle uses its own fixed seed and does not change generation randomness. The recorded enemy count, available XP, credited XP, cumulative XP, level, choice count and level-crossing floor are exact for this accounting policy. Fractional exposures do not represent normal/heavy routes or player behavior. They bypass movement, combat, deaths, loot and timing; no completion or elapsed-minute claim should be inferred. Counting all arena enemies is a consistent exposure convention, not a claim that every auxiliary must be killed to unlock the Heart.

Separate exhaustion probes credit thresholds one at a time and credit the whole 270-XP total at once. The latter exercises queued-choice rebasing and detects owned-only/duplicate offers that incremental play might not reach. Both must finish at level 10 with four unique Huntress talents and no pending or queued choice.

## Base-kit encounter controls

The production simulation runs at 60-Hz real frames on the existing open-room fixture. Enemy compositions: guard, charger, archer, guard+archer, two guards, charger+guard. Enemy AI, damage, collisions, shields, armor, arrow recovery, health and ordinary actions remain active. Enemies start alert at documented fixture positions. No HP protection, forced damage, upgraded gear, talent effects or resupply is applied.

Both baseline and candidate receive one explicitly injected, already-known healing potion so potion reservation/completion/interruption can be observed. This is fixture stock, not actual campaign starting stock. The normal class bow, knife, eight arrows and two of each tip remain unchanged.

Each composition runs with two simple policies and two aim-error magnitudes, for 24 rows:

- `ranged`: repeatedly aim/shoot at the nearest target, falling back to melee if arrows are empty
- `mixed`: one opening ordinary shot per target, eligible paralysis/chill attempts, and knife at close range; move toward a distant target after the opening

Both policies select the nearest live enemy omnisciently within this fully open fixture, have no learned tactics, do not recognize shield openings, and do not predict projectiles. The only dodge-like behavior is a simple alternating strafe against distant archers. Aim is sampled every 0.2 real seconds and held between decisions; yaw error is a deterministic sinusoid bounded by 1.5° or 4°, and pitch error by half that bound. Aiming uses current body position, not ballistic leading. Thus these controls deliberately are not the repository's older perfect-aim bot or a human-performance model.

Actions are committed only through normal input. A known healing potion is requested at or below 55% HP when idle. The run stops on clearance, death, 45 world seconds or 180 real seconds; failures remain failures. Each row records world/real time, damage, attempted normal/tipped/knife/potion actions, shots released, hits, completed healing/restoration/waste, remaining stock, surviving enemies and damage by tool/source. Attempted actions can exceed released shots or completed potions when interrupted. Remaining normal arrows can rise through real pickups; it is not equivalent to starting stock minus shot count.

The main regression criterion is exact equality of every recorded encounter field across source versions. Policy success rates or the weak shield-blind ranged behavior are not evidence about class strength, resource sufficiency, challenge or enjoyment.
