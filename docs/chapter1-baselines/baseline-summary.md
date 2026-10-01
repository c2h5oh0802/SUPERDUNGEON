# Fresh Rune-free baseline results

All 42 protected cost/exposure scenarios completed all four floors and their declared route policy. All 18 unprotected simple-melee controls died before completing; these are not human survival or fun judgments. See METHODOLOGY.md for fixed policies and limitations.

Source: parent-verified upstream content 779c53e; exact measured source bytes are in baseline-source-sha256.json.

| Class | Seed | Policy | World seconds | Food found/used/left | End Hunger | Starvation HP |
|---|---|---|---:|---:|---:|---:|
| warrior | FLOW1 | direct | 62.050 | 4/0/4 | 62.050 | 0 |
| warrior | FLOW1 | normal | 139.150 | 4/1/3 | 79.150 | 0 |
| warrior | FLOW1 | heavy | 214.459 | 4/2/2 | 94.459 | 0 |
| warrior | FLOW1 | full_clear | 374.285 | 4/4/0 | 134.285 | 0 |
| warrior | FLOW1 | long_shift | 118.857 | 4/0/4 | 118.857 | 0 |
| warrior | FLOW1 | wait60 | 302.852 | 4/4/0 | 62.852 | 0 |
| warrior | FLOW1 | wait180 | 782.050 | 4/4/0 | 180.000 | 22 |
| warrior | FLOW2 | direct | 72.717 | 4/0/4 | 72.717 | 0 |
| warrior | FLOW2 | normal | 176.054 | 4/1/3 | 116.054 | 0 |
| warrior | FLOW2 | heavy | 216.211 | 4/2/2 | 96.211 | 0 |
| warrior | FLOW2 | full_clear | 414.098 | 4/4/0 | 174.098 | 0 |
| warrior | FLOW2 | long_shift | 139.993 | 4/1/3 | 79.993 | 0 |
| warrior | FLOW2 | wait60 | 313.533 | 4/4/0 | 73.533 | 0 |
| warrior | FLOW2 | wait180 | 792.717 | 4/4/0 | 180.000 | 23 |
| warrior | LIVING1 | direct | 67.590 | 4/0/4 | 67.590 | 0 |
| warrior | LIVING1 | normal | 165.485 | 4/1/3 | 105.485 | 0 |
| warrior | LIVING1 | heavy | 190.452 | 4/2/2 | 70.452 | 0 |
| warrior | LIVING1 | full_clear | 388.503 | 4/4/0 | 148.503 | 0 |
| warrior | LIVING1 | long_shift | 130.349 | 4/1/3 | 70.349 | 0 |
| warrior | LIVING1 | wait60 | 308.374 | 4/4/0 | 68.374 | 0 |
| warrior | LIVING1 | wait180 | 787.590 | 4/4/0 | 180.000 | 23 |
| huntress | FLOW1 | direct | 62.050 | 4/0/4 | 62.050 | 0 |
| huntress | FLOW1 | normal | 146.786 | 4/1/3 | 86.786 | 0 |
| huntress | FLOW1 | heavy | 221.877 | 4/2/2 | 101.877 | 0 |
| huntress | FLOW1 | full_clear | 392.670 | 4/4/0 | 152.670 | 0 |
| huntress | FLOW1 | long_shift | 118.857 | 4/0/4 | 118.857 | 0 |
| huntress | FLOW1 | wait60 | 302.852 | 4/4/0 | 62.852 | 0 |
| huntress | FLOW1 | wait180 | 782.050 | 4/4/0 | 180.000 | 22 |
| huntress | FLOW2 | direct | 72.717 | 4/0/4 | 72.717 | 0 |
| huntress | FLOW2 | normal | 179.733 | 4/1/3 | 119.733 | 0 |
| huntress | FLOW2 | heavy | 217.854 | 4/2/2 | 97.854 | 0 |
| huntress | FLOW2 | full_clear | 421.391 | 4/4/0 | 180.000 | 0 |
| huntress | FLOW2 | long_shift | 139.993 | 4/1/3 | 79.993 | 0 |
| huntress | FLOW2 | wait60 | 313.533 | 4/4/0 | 73.533 | 0 |
| huntress | FLOW2 | wait180 | 792.717 | 4/4/0 | 180.000 | 23 |
| huntress | LIVING1 | direct | 67.590 | 4/0/4 | 67.590 | 0 |
| huntress | LIVING1 | normal | 169.339 | 4/1/3 | 109.339 | 0 |
| huntress | LIVING1 | heavy | 197.484 | 4/2/2 | 77.484 | 0 |
| huntress | LIVING1 | full_clear | 360.791 | 4/4/0 | 120.791 | 0 |
| huntress | LIVING1 | long_shift | 130.349 | 4/1/3 | 70.349 | 0 |
| huntress | LIVING1 | wait60 | 308.374 | 4/4/0 | 68.374 | 0 |
| huntress | LIVING1 | wait180 | 787.590 | 4/4/0 | 180.000 | 23 |

## Verification

- Complete resource conservation passes: initial + acquired + granted − reserved/used = remaining
- First-option talent/floor grants are recorded separately from pickups
- All seven FLOW1 Warrior rows reran with exactly equal parsed JSON records
- Source SHA-256 remained unchanged
- Full per-floor stocks, individual bag consumables, remaining ground loot, damage, choices-derived grants and timing breakdowns are in baseline.json
- Protected campaign bot attacks with melee only; unspent arrows, tips, stones, smoke and inventory potion/scrolls are policy limits, not evidence of surplus balance

## Unprotected controls

| Class | Seed | Policy | World seconds at death | Reached floor | Healing potions used |
|---|---|---|---:|---:|---:|
| warrior | FLOW1 | normal | 79.776 | 3 | 3 |
| warrior | FLOW1 | heavy | 116.044 | 3 | 3 |
| warrior | FLOW1 | full_clear | 110.008 | 2 | 2 |
| warrior | FLOW2 | normal | 84.128 | 2 | 3 |
| warrior | FLOW2 | heavy | 52.995 | 2 | 2 |
| warrior | FLOW2 | full_clear | 132.054 | 2 | 3 |
| warrior | LIVING1 | normal | 87.010 | 3 | 3 |
| warrior | LIVING1 | heavy | 80.608 | 2 | 3 |
| warrior | LIVING1 | full_clear | 105.597 | 2 | 3 |
| huntress | FLOW1 | normal | 49.925 | 2 | 2 |
| huntress | FLOW1 | heavy | 54.795 | 2 | 2 |
| huntress | FLOW1 | full_clear | 42.585 | 1 | 2 |
| huntress | FLOW2 | normal | 80.372 | 2 | 3 |
| huntress | FLOW2 | heavy | 45.066 | 1 | 2 |
| huntress | FLOW2 | full_clear | 32.308 | 1 | 1 |
| huntress | LIVING1 | normal | 13.648 | 1 | 1 |
| huntress | LIVING1 | heavy | 13.648 | 1 | 1 |
| huntress | LIVING1 | full_clear | 13.898 | 1 | 1 |
