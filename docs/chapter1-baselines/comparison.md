# Chapter v1 resource calibration

Status: Ready for Human Review. These are deterministic simulation cost/exposure measurements, not a human survival/fun verdict.

The baseline has four floors. The candidate has four exploration floors plus a gated, supply-free guardian arena; Hunger freezes once that encounter activates/resolves. Raw results keep exploration and arena separate. Both use the same adapted harness v1.3. See METHODOLOGY.md for full policies, controls and limitations.

## Complete protected matrix

Every protected row below completed the configured campaign and declared route policy. HP is restored to normal maximum each frame; actual combat damage and starvation damage remain recorded. The simple bot uses melee for both classes, so unspent bow/tips/smoke/scrolls do not establish their balance.

| Class | Seed | Policy | Before s | After s | Delta s | Explore s | Arena s | Food found/used/left | End Hunger | Starvation HP before→after |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| warrior | FLOW1 | direct | 62.050 | 66.515 | +4.465 | 62.050 | 4.466 | 4/0/4 | 62.050 | 0→0 |
| warrior | FLOW1 | normal | 139.150 | 146.184 | +7.034 | 137.829 | 8.356 | 4/1/3 | 80.313 | 0→0 |
| warrior | FLOW1 | heavy | 214.459 | 210.206 | -4.253 | 201.850 | 8.356 | 5/2/3 | 84.335 | 0→0 |
| warrior | FLOW1 | full_clear | 374.285 | 367.739 | -6.546 | 357.964 | 9.775 | 6/5/1 | 61.492 | 0→0 |
| warrior | FLOW1 | long_shift | 118.857 | 126.882 | +8.025 | 118.857 | 8.025 | 4/0/4 | 118.857 | 0→0 |
| warrior | FLOW1 | wait60 | 302.852 | 367.318 | +64.466 | 302.852 | 64.466 | 4/4/0 | 62.852 | 0→0 |
| warrior | FLOW1 | wait180 | 782.050 | 969.574 | +187.524 | 785.110 | 184.466 | 4/4/0 | 131.839 | 22→25 |
| warrior | FLOW2 | direct | 72.717 | 77.183 | +4.466 | 72.717 | 4.466 | 4/0/4 | 72.717 | 0→0 |
| warrior | FLOW2 | normal | 176.054 | 159.400 | -16.654 | 151.044 | 8.356 | 4/1/3 | 93.529 | 0→0 |
| warrior | FLOW2 | heavy | 216.211 | 204.942 | -11.269 | 196.587 | 8.356 | 4/2/2 | 79.071 | 0→0 |
| warrior | FLOW2 | full_clear | 414.098 | 394.956 | -19.142 | 385.932 | 9.023 | 5/5/0 | 88.710 | 0→0 |
| warrior | FLOW2 | long_shift | 139.993 | 148.017 | +8.024 | 139.993 | 8.025 | 4/1/3 | 79.993 | 0→0 |
| warrior | FLOW2 | wait60 | 313.533 | 377.999 | +64.466 | 313.533 | 64.466 | 4/4/0 | 73.533 | 0→0 |
| warrior | FLOW2 | wait180 | 792.717 | 980.195 | +187.478 | 795.729 | 184.466 | 4/4/0 | 136.624 | 23→27 |
| warrior | LIVING1 | direct | 67.590 | 72.056 | +4.466 | 67.590 | 4.466 | 4/0/4 | 67.590 | 0→0 |
| warrior | LIVING1 | normal | 165.485 | 157.288 | -8.197 | 148.932 | 8.356 | 4/1/3 | 91.416 | 0→0 |
| warrior | LIVING1 | heavy | 190.452 | 225.211 | +34.759 | 216.855 | 8.356 | 4/2/2 | 99.339 | 0→0 |
| warrior | LIVING1 | full_clear | 388.503 | 380.149 | -8.354 | 371.263 | 8.886 | 5/5/0 | 73.902 | 0→0 |
| warrior | LIVING1 | long_shift | 130.349 | 138.374 | +8.025 | 130.350 | 8.025 | 4/1/3 | 70.349 | 0→0 |
| warrior | LIVING1 | wait60 | 308.374 | 372.839 | +64.465 | 308.374 | 64.466 | 4/4/0 | 68.374 | 0→0 |
| warrior | LIVING1 | wait180 | 787.590 | 974.961 | +187.371 | 790.496 | 184.466 | 4/4/0 | 131.550 | 23→27 |
| huntress | FLOW1 | direct | 62.050 | 66.515 | +4.465 | 62.050 | 4.466 | 4/0/4 | 62.050 | 0→0 |
| huntress | FLOW1 | normal | 146.786 | 150.974 | +4.188 | 141.664 | 9.310 | 4/1/3 | 84.148 | 0→0 |
| huntress | FLOW1 | heavy | 221.877 | 225.488 | +3.611 | 216.177 | 9.310 | 5/2/3 | 98.662 | 0→0 |
| huntress | FLOW1 | full_clear | 392.670 | 375.734 | -16.936 | 365.308 | 10.427 | 6/5/1 | 68.083 | 0→0 |
| huntress | FLOW1 | long_shift | 118.857 | 126.882 | +8.025 | 118.857 | 8.025 | 4/0/4 | 118.857 | 0→0 |
| huntress | FLOW1 | wait60 | 302.852 | 367.318 | +64.466 | 302.852 | 64.466 | 4/4/0 | 62.852 | 0→0 |
| huntress | FLOW1 | wait180 | 782.050 | 969.574 | +187.524 | 785.110 | 184.466 | 4/4/0 | 131.839 | 22→25 |
| huntress | FLOW2 | direct | 72.717 | 77.183 | +4.466 | 72.717 | 4.466 | 4/0/4 | 72.717 | 0→0 |
| huntress | FLOW2 | normal | 179.733 | 165.071 | -14.662 | 155.761 | 9.310 | 5/1/4 | 98.246 | 0→0 |
| huntress | FLOW2 | heavy | 217.854 | 208.266 | -9.588 | 198.956 | 9.310 | 4/2/2 | 81.441 | 0→0 |
| huntress | FLOW2 | full_clear | 421.391 | 403.884 | -17.507 | 393.458 | 10.427 | 5/5/0 | 96.234 | 0→0 |
| huntress | FLOW2 | long_shift | 139.993 | 148.017 | +8.024 | 139.993 | 8.025 | 4/1/3 | 79.993 | 0→0 |
| huntress | FLOW2 | wait60 | 313.533 | 377.999 | +64.466 | 313.533 | 64.466 | 4/4/0 | 73.533 | 0→0 |
| huntress | FLOW2 | wait180 | 792.717 | 980.195 | +187.478 | 795.729 | 184.466 | 4/4/0 | 136.624 | 23→27 |
| huntress | LIVING1 | direct | 67.590 | 72.056 | +4.466 | 67.590 | 4.466 | 4/0/4 | 67.590 | 0→0 |
| huntress | LIVING1 | normal | 169.339 | 162.846 | -6.493 | 153.425 | 9.421 | 4/1/3 | 95.910 | 0→0 |
| huntress | LIVING1 | heavy | 197.484 | 239.529 | +42.045 | 230.109 | 9.421 | 4/2/2 | 112.593 | 0→0 |
| huntress | LIVING1 | full_clear | 360.791 | 408.758 | +47.967 | 398.468 | 10.290 | 5/5/0 | 101.108 | 0→0 |
| huntress | LIVING1 | long_shift | 130.349 | 138.374 | +8.025 | 130.350 | 8.025 | 4/1/3 | 70.349 | 0→0 |
| huntress | LIVING1 | wait60 | 308.374 | 372.839 | +64.465 | 308.374 | 64.466 | 4/4/0 | 68.374 | 0→0 |
| huntress | LIVING1 | wait180 | 787.590 | 974.961 | +187.371 | 790.496 | 184.466 | 4/4/0 | 131.550 | 23→27 |

## Other consumables, actually acquired / reserved-used / remaining

Totals below exclude food but include stock ammo, stones, smoke, healing and tipped arrows plus individual bag potion/scroll items. They are unit counts, not normalized resource value. Class starts and talent/floor grants are recorded separately in raw JSON; detailed per-ID counts and per-floor remaining ground resources are preserved there.

| Class | Seed | Policy | Acquired units | Used units | Remaining units |
|---|---|---|---:|---:|---:|
| warrior | FLOW1 | direct | 3 | 0 | 8 |
| warrior | FLOW1 | normal | 15 | 0 | 20 |
| warrior | FLOW1 | heavy | 24 | 0 | 29 |
| warrior | FLOW1 | full_clear | 29 | 0 | 34 |
| warrior | FLOW1 | long_shift | 3 | 0 | 8 |
| warrior | FLOW1 | wait60 | 3 | 0 | 8 |
| warrior | FLOW1 | wait180 | 3 | 0 | 8 |
| warrior | FLOW2 | direct | 6 | 0 | 11 |
| warrior | FLOW2 | normal | 23 | 0 | 28 |
| warrior | FLOW2 | heavy | 25 | 0 | 30 |
| warrior | FLOW2 | full_clear | 37 | 0 | 42 |
| warrior | FLOW2 | long_shift | 6 | 0 | 11 |
| warrior | FLOW2 | wait60 | 6 | 0 | 11 |
| warrior | FLOW2 | wait180 | 6 | 0 | 11 |
| warrior | LIVING1 | direct | 5 | 0 | 10 |
| warrior | LIVING1 | normal | 21 | 0 | 26 |
| warrior | LIVING1 | heavy | 29 | 0 | 34 |
| warrior | LIVING1 | full_clear | 29 | 0 | 34 |
| warrior | LIVING1 | long_shift | 5 | 0 | 10 |
| warrior | LIVING1 | wait60 | 5 | 0 | 10 |
| warrior | LIVING1 | wait180 | 5 | 0 | 10 |
| huntress | FLOW1 | direct | 3 | 0 | 17 |
| huntress | FLOW1 | normal | 16 | 0 | 32 |
| huntress | FLOW1 | heavy | 23 | 0 | 39 |
| huntress | FLOW1 | full_clear | 30 | 0 | 46 |
| huntress | FLOW1 | long_shift | 3 | 0 | 17 |
| huntress | FLOW1 | wait60 | 3 | 0 | 17 |
| huntress | FLOW1 | wait180 | 3 | 0 | 17 |
| huntress | FLOW2 | direct | 6 | 0 | 20 |
| huntress | FLOW2 | normal | 22 | 0 | 38 |
| huntress | FLOW2 | heavy | 22 | 0 | 38 |
| huntress | FLOW2 | full_clear | 37 | 0 | 53 |
| huntress | FLOW2 | long_shift | 6 | 0 | 20 |
| huntress | FLOW2 | wait60 | 6 | 0 | 20 |
| huntress | FLOW2 | wait180 | 6 | 0 | 20 |
| huntress | LIVING1 | direct | 5 | 0 | 19 |
| huntress | LIVING1 | normal | 19 | 0 | 33 |
| huntress | LIVING1 | heavy | 25 | 0 | 41 |
| huntress | LIVING1 | full_clear | 33 | 0 | 49 |
| huntress | LIVING1 | long_shift | 5 | 0 | 19 |
| huntress | LIVING1 | wait60 | 5 | 0 | 19 |
| huntress | LIVING1 | wait180 | 5 | 0 | 19 |

## Unprotected controls

No HP restoration; healing potion input at ≤ half HP. All campaign termination, time, potion usage and other counters below are actually measured. Early deaths are incomplete runs, not four/five-floor cost estimates.

| Class | Seed | Policy | Before death s / reached floor | After death s / reached floor | Healing used before→after |
|---|---|---|---:|---:|---:|
| warrior | FLOW1 | normal | 79.776 / 3 | 85.812 / 3 | 3→4 |
| warrior | FLOW1 | heavy | 116.044 / 3 | 61.202 / 2 | 3→3 |
| warrior | FLOW1 | full_clear | 110.008 / 2 | 135.514 / 2 | 2→3 |
| warrior | FLOW2 | normal | 84.128 / 2 | 94.018 / 3 | 3→3 |
| warrior | FLOW2 | heavy | 52.995 / 2 | 42.441 / 1 | 2→2 |
| warrior | FLOW2 | full_clear | 132.054 / 2 | 201.863 / 3 | 3→5 |
| warrior | LIVING1 | normal | 87.010 / 3 | 20.891 / 1 | 3→2 |
| warrior | LIVING1 | heavy | 80.608 / 2 | 130.394 / 3 | 3→6 |
| warrior | LIVING1 | full_clear | 105.597 / 2 | 126.036 / 2 | 3→5 |
| huntress | FLOW1 | normal | 49.925 / 2 | 49.451 / 2 | 2→2 |
| huntress | FLOW1 | heavy | 54.795 / 2 | 53.836 / 2 | 2→3 |
| huntress | FLOW1 | full_clear | 42.585 / 1 | 101.110 / 2 | 2→3 |
| huntress | FLOW2 | normal | 80.372 / 2 | 81.444 / 3 | 3→3 |
| huntress | FLOW2 | heavy | 45.066 / 1 | 55.765 / 2 | 2→3 |
| huntress | FLOW2 | full_clear | 32.308 / 1 | 32.308 / 1 | 1→1 |
| huntress | LIVING1 | normal | 13.648 / 1 | 20.891 / 1 | 1→2 |
| huntress | LIVING1 | heavy | 13.648 / 1 | 60.624 / 1 | 1→3 |
| huntress | LIVING1 | full_clear | 13.898 / 1 | 18.752 / 1 | 1→1 |

## Verification

- Each protected matrix has 42 unique rows; each unprotected matrix has 18
- Inventory conservation: initial + acquired + granted − used = remaining for every tracked ID
- Completion uses the source-defined floor count; policy completion is separately checked
- Original baseline rerun under the arena-aware adapter preserved every pre-existing metric exactly
- Scripts are `.mjs` outside tests, passed repository ESLint, use existing esbuild, and bundle in memory
- No production file was edited by the calibration worker
- Per-run source SHA-256 identifies the measured snapshot; source is checked before/after bundling

## Files

- baseline.json, baseline-survival.json: fresh Rune-free baseline
- after.json, after-survival.json: final measured candidate
- comparison.json: compact before/after numeric comparison
- placement-iterations.json: compact initial/waypoint/final placement evidence; full intermediate raw runs retained in calibration scratch
- METHODOLOGY.md: fixed policies, accounting, arena adaptation and reproduction
- ../../scripts/chapter-calibration/: repository-ready harness, runner and validator
