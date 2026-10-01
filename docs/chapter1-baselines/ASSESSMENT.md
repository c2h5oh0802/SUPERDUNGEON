# What the measurements establish

- Food is reliably acquired by the final ordinary-route proxy: all six normal runs collect 4–5 rations, use one, and end at Hunger 80.313–98.246 with no starvation damage
- Heavy routes collect 4–5, use two, and end at Hunger 79.071–112.593; all six have zero starvation damage
- Full-clear routes collect 5–6, use five, and end at Hunger 61.492–101.108; all six have zero starvation damage. One or zero rations remain. “Full-clear” visits every room/chest and kills every enemy, but does not sweep every ground-item coordinate
- Long Shift and 60-second waits on each floor produce no starvation damage in the measured controls. 180-second waits still cause 25–27 starvation HP, even after four meals; rations are acquired after leaving each entrance rather than immediately at spawn
- The dedicated arena costs 8.356–10.427 world seconds for the live melee proxy. It is not an excessive runtime addition in this sample, but the bot is perfect-aim, omniscient and HP-protected. Human arena duration and difficulty remain unverified
- Total normal route time is 146.184–165.071 seconds; heavy 204.942–239.529; full-clear 367.739–408.758. Individual seed/class before→after differences are preserved in comparison.json. These changes combine altered supplies, route choices, enemies and the new arena; they cannot be attributed solely to one added floor

## Placement correction was driven by observed misses

The initial room-centered placement produced zero acquired rations on all six normal routes despite six generated rations. Initial heavy routes acquired 0–2 and some took 1–3 starvation HP. Selecting a smoothed navigation waypoint improved full-clear collection but still left every normal run at zero. Sampling along the actual path segments to the first safe room-entry point corrected this: final normal runs acquire 4–5. Food quantities, Hunger thresholds and bot tactics were not increased to force that result.

The compact placement iteration record preserves these measurements. The final matrix was rerun after the remaining source corrections, with exact source SHA-256 sidecars.

## Limits that matter for acceptance

Protected runs restore ordinary maximum HP every frame and are timing/exposure proxies. Every one of the 18 baseline and 18 final unprotected simple-melee controls died before finishing. Final controls reached at most floor 3, with deaths at 18.752–201.863 world seconds; they used 1–6 actual healing potions. These results do not establish human survivability.

Both class campaign bots use their melee weapon. Bow/tipped-arrow, smoke, potion/scroll puzzle solutions and tactical loadout decisions are not exercised. Their zero measured use must not be described as evidence that consumables are unnecessary, abundant or balanced. Source mechanics/unit tests and human play must provide that separate evidence.

Hunger state-exposure time includes time spent displaying a frozen state in the arena. Use actual recorded starvation HP and segment entry/end Hunger; do not infer Hunger-clock damage from that display-time bucket. Enemy-removed traversal controls resolve the arena immediately and therefore do not test its combat or pre-activation Hunger cost.
