# Encounter trial measurements

These are small, deterministic **policy probes, not a human playtest, optimal-strategy search, difficulty estimate, or proof of fun**. They establish that alternatives can finish the authored fixtures and expose concrete failure modes. No game values were tuned to the controller.

## Reproduce

From the repository root, using installed dependencies:

```sh
node scripts/encounter-trials/run.mjs --verify
node scripts/encounter-trials/run.mjs --raw /tmp/encounter-trials-raw.json
```

The first command compares all 30 final results exactly. The second regenerates the compact published results while retaining full event/checkpoint data at the supplied path. It preserves the 80 earlier exploratory result rows. Esbuild bundles in memory; there are no package changes, generated bundles, or large hash inventories. A combined source fingerprint and harness hash identify the final measurement revision.

## Fixtures and inputs

Every run starts with `createTrialWorld(id, 'huntress')` at the authored spawn. Seeds are `TRIAL-SHIELD`, `TRIAL-CHARGER`, and `TRIAL-CLUSTER`. Geometry, HP, AI, combat, drops, item effects, and trial inventory remain unchanged. There are no teleports, forced enemy positions/states, added supplies, or invulnerability. This measures the Huntress only.

Movement, tool selection, firing, waiting, and chest interaction use actual `FrameInput` at 60 Hz. Inventory throws use the same `queueUse` entry point as the UI. No conversion is used. Ordinary routes never select a tipped arrow or bottle. Natural arrow pickups, enemy friendly fire, and progression remain active. Any talent choice selects the first offered option; choices are logged. Level-up HP restoration means final HP is not simply starting HP minus damage.

Two paired input regimes are used: 1.5-degree horizontal aim error with 0.2-real-second decisions, and 4 degrees with 0.3-second decisions. Pitch error is half the horizontal bound. Errors are deterministic sinusoidal functions of decision count. These are **not statistical samples**, and precision and reaction time are confounded: do not infer either variable's independent effect. A higher-error result can be better due to changed timings. `wait=true` keeps world time moving during held decisions; there is no pause-based perfect reaction.

The controller is deliberately approximate. It knows fixture waypoints and reads enemy states/positions directly, which is stronger than human perception. It fires only at a target with static line of sight, but uses exact phase/shield state for tool timing. It does not predict projectile trajectories or find optimal policies. Final navigation uses the engine's player-radius `Nav` only to approach an occluded archer or the chest; combat movement against guards/chargers remains the simple controller. This is a known-map navigation aid, not player pathfinding or a geometry edit.

Combat fixtures stop on all enemies dead, death, or 60 world / 90 real seconds. Cluster success requires opening its empty chest; clearing enemies alone is insufficient. Full runs include travel time from spawn. No healing policy is used.

## Policies

- Shield: approach until a guard commits, backpedal/strafe, and aim at the head when its shield is down. The tipped variant spends available paralysis/chill arrows; it does not bypass shields.
- Charger: west routes favor cover; open-north routes prioritize the charger while crossing the archer's lane. Knife policies approach during stun/recovery, otherwise use ordinary arrows. They can take damage during initial travel.
- Cluster lane: walk up the short lane and fight the nearest visible enemy. Gas/frost variants throw once, then use ordinary arrows; tipped uses available tips. Archer-first variants are retained failures.
- Cluster ordinary lure: step into the lane, retreat south, then west behind its wall, fight the pursuing guards using ordinary arrows, and approach the archer afterward.
- Cluster bypass: follow the western loop and open the chest without attacking or using tools. It briefly re-enters archer LOS near the destination, so zero damage does not imply zero geometric exposure.

## What the final 30 probes support

Numbers below are low-error / higher-error paired regimes, rounded to two decimals.

| Route | Completion world seconds | Incoming damage | Player shots |
| --- | ---: | ---: | ---: |
| Shield, ordinary bait | 4.57 / 4.97 | 0 / 0 | 3 / 3 |
| Shield, tipped bait | 6.57 / 5.68 | 0 / 0 | 5 / 3 |
| Charger, ordinary west | 5.47 / 7.45 | 0 / 0 | 2 / 4 |
| Cluster, ordinary lure | 13.80 / 12.89 | 6 / 0 | 7 / 5 |
| Cluster, gas lane | 10.00 / 16.19 | 5 / 8 | 6 / 11 |
| Cluster, frost lane | 9.80 / failed at 5.49 | 6 / 11 | 8 / 3 |
| Cluster, tipped lane | 8.20 / 8.40 | 8 / 3 | 7 / 4 |
| Cluster, noncombat loop | 7.20 / 7.50 | 0 / 0 | 0 / 0 |

Ordinary arrows are a viable player-tool choice in all three fixtures. The ordinary cluster runs also include **2 damage from an enemy bolt hitting another enemy**; this is normal active AI, not an arrows-only damage claim. Both ordinary direct-lane attempts die, as do both ordinary archer-first attempts. Tools are optional and do not guarantee success or dominate on every measure. Both AoE bottles affect two guards; gas also stuns the player once in each run. The bypass remains a meaningful low-cost choice for an empty optional objective.

The charger open-north knife routes spend 0.37 / 0.77 seconds of knife action with the archer's firing lane clear, compared with 0 / 0.32 for west knife routes. Their clear-lane time during charger stun is 1.03 / 0.80 versus 0 / 0.13 seconds. An open-north low-error run takes 2 archer damage, but **after** the charger dies; do not claim the knife action itself caused that hit. The probes establish simultaneous exposure during punish windows, not a universal damage penalty. The independent deterministic charger tests provide a separate exact-position witness.

## Metrics and retained failures

`damage` is gross recorded incoming damage, including overkill; `damageByTool` includes friendly bolts and can exceed remaining enemy HP. `shots` counts released arrows including tips; `actions` counts started actions and can exceed releases at death. Ammo remaining includes natural pickups. Bottle identities and control durations are recorded separately.

`archerLOS` is a static eye-to-archer-torso line (player y=1.55, archer y+1.3), ignoring intervening actors. Final `archerFiringLaneClear` uses the real `archerLineClear` query, including terrain, bolt radius, and other enemies. Neither measure is hit probability or proof the archer is currently facing/aware; actual aim/locked-aim durations and fire counts are also recorded. Exposure integrates actual world time sampled at 60 Hz. Control seconds count remaining slow/paralysis state, including persistence after leaving an area, not just time inside a bottle cloud.

All **110 attempts** are represented in `measurements.json`: 30 final structured records plus 80 exploratory rows with an explicit column schema. Earlier failed policies are not removed from success denominators or portrayed as geometry defects:

- v1: 20 attempts; a coarse waypoint controller oscillated indefinitely on the higher-error bypass
- v2: 30 attempts; speed-capped waypoints fixed that oscillation, but straight-line pursuit stalled the high-error ordinary lure at a wall, and a gas run cleared enemies but stalled at the archer platform before the chest
- v3: 30 attempts; broad navigation fixed stalls but changed guard approach timing and killed the higher-error lure run
- final v4: 30 attempts; navigation is restricted to occluded-archer/chest travel, retaining prior combat movement and every earlier failure

Raw exploratory traces, original harness snapshots, and source inventories were preserved outside the repository before compacting the deliverable. Current raw traces can be regenerated with the command above. These observations justify keeping alternative routes available and trying them with people; they do not establish player preference or campaign balance.
