# Healing economy: paired deterministic measurements

Before → after throughout. Values are measured, not estimates. HP-restored proxies and natural-death controls are separate evidence. See METHODOLOGY.md and ASSESSMENT.md for limits.

## Generated supply

| Seed | Chests/chapter | Generated healing | Start healing Warrior/Huntress |
|---|---:|---:|---:|
| FLOW1 | 8 → 8 | 12 → 16 | 1/1 → 0/0 |
| FLOW2 | 8 → 8 | 12 → 14 | 1/1 → 0/0 |
| LIVING1 | 8 → 8 | 12 → 14 | 1/1 → 0/0 |

## primary simple-melee control

### Full-chapter HP-restored exposure proxies

Ranges cover the three fixed seeds. Artificial HP restoration suppresses healing demand; zero use is not evidence of sufficient or excessive supply.

| Class / route | Completed | Damage HP | Healing found/used/left | Food found/used/left | End Hunger | Starvation HP | Upgrades used |
|---|---:|---:|---|---|---:|---:|---:|
| warrior / normal | 3/3 → 3/3 | 73–89 → 73–89 | 2/0/3 → 4/0/4 | 4/1/3 → 4/1/3 | 80.313–93.529 → 80.313–93.529 | 0 → 0 | 0 → 0 |
| warrior / heavy | 3/3 → 3/3 | 75–123 → 75–123 | 2/0/3 → 8/0/8 | 4–5/2/2–3 → 4–5/2/2–3 | 79.071–99.339 → 79.071–99.339 | 0 → 0 | 0 → 0 |
| warrior / full_clear | 3/3 → 3/3 | 126–133 → 126–133 | 2/0/3 → 8/0/8 | 5–6/5/0–1 → 5–6/5/0–1 | 61.492–88.71 → 61.492–88.71 | 0 → 0 | 0 → 0 |
| huntress / normal | 3/3 → 3/3 | 118–154 → 118–154 | 2/0/3 → 4/0/4 | 4–5/1/3–4 → 4–5/1/3–4 | 84.148–98.246 → 84.148–98.246 | 0 → 0 | 0 → 0 |
| huntress / heavy | 3/3 → 3/3 | 175–188 → 175–188 | 2/0/3 → 8/0/8 | 4–5/2/2–3 → 4–5/2/2–3 | 81.441–112.593 → 81.441–112.593 | 0 → 0 | 0 → 0 |
| huntress / full_clear | 3/3 → 3/3 | 183–198 → 183–198 | 2/0/3 → 8/0/8 | 5–6/5/0–1 → 5–6/5/0–1 | 68.083–101.108 → 68.083–101.108 | 0 → 0 | 0 → 0 |

### Unprotected controls, stopping naturally

F/U/L = acquired healing units / reserved units / remaining units. Reservation can precede death; completed/restored values are in JSON. “Reached floor” is not a completion claim.

| Class / seed / route | Damage HP | Healing F/U/L | Deaths / floor reached | HP entering floors, before → after | Final HP | End Hunger | Food used | Upgrades used |
|---|---:|---|---|---|---:|---:|---:|---:|
| warrior / FLOW1 / normal | 30 → 34 | 2/3/0 → 3/3/0 | 1/2 → 1/3 | 1:10/10, 2:8/16 → 1:10/10, 2:7/16, 3:3/20 | 0 → 0 | 70.956 → 86.462 | 0 → 0 | 0 → 0 |
| warrior / FLOW1 / heavy | 34 → 90 | 3/4/0 → 8/8/0 | 1/2 → 0/5 | 1:10/10, 2:11/18 → 1:10/10, 2:12/18, 3:14/22, 4:14/24, 5:27/28 | 0 → 21 | 63.779 → 90.108 | 0 → 2 | 0 → 0 |
| warrior / FLOW1 / full_clear | 34 → 88 | 3/4/0 → 6/6/0 | 1/2 → 1/4 | 1:10/10, 2:9/18 → 1:10/10, 2:13/18, 3:22/22, 4:10/26 | 0 → 0 | 75.732 → 105.821 | 1 → 3 | 0 → 0 |
| warrior / FLOW2 / normal | 32 → 33 | 2/3/0 → 2/2/0 | 1/3 → 1/3 | 1:10/10, 2:14/16, 3:12/18 → 1:10/10, 2:15/16, 3:10/18 | 0 → 0 | 95.749 → 91.656 | 0 → 0 | 0 → 0 |
| warrior / FLOW2 / heavy | 40 → 55 | 4/5/0 → 4/4/0 | 1/2 → 1/3 | 1:10/10, 2:7/18 → 1:10/10, 2:11/18, 3:8/20 | 0 → 0 | 79.455 → 105.463 | 0 → 0 | 0 → 0 |
| warrior / FLOW2 / full_clear | 40 → 64 | 4/5/0 → 4/4/0 | 1/2 → 1/3 | 1:10/10, 2:11/18 → 1:10/10, 2:12/18, 3:16/22 | 0 → 0 | 69.258 → 105.078 | 1 → 2 | 0 → 0 |
| warrior / LIVING1 / normal | 15 → 32 | 1/2/0 → 2/2/0 | 1/1 → 1/2 | 1:10/10 → 1:10/10, 2:6/16 | 0 → 0 | 20.891 → 60.894 | 0 → 0 | 0 → 0 |
| warrior / LIVING1 / heavy | 32 → 32 | 2/3/0 → 3/3/0 | 1/1 → 1/2 | 1:10/10 → 1:10/10, 2:4/18 | 0 → 0 | 60.572 → 76.093 | 0 → 0 | 0 → 0 |
| warrior / LIVING1 / full_clear | 42 → 87 | 4/5/0 → 6/6/0 | 1/2 → 1/3 | 1:10/10, 2:10/20 → 1:10/10, 2:19/20, 3:10/22 | 0 → 0 | 118.018 → 105.546 | 0 → 2 | 0 → 0 |
| huntress / FLOW1 / normal | 26 → 23 | 2/3/0 → 2/2/0 | 1/2 → 1/2 | 1:10/10, 2:7/16 → 1:10/10, 2:7/16 | 0 → 0 | 54.11 → 53.312 | 0 → 0 | 0 → 0 |
| huntress / FLOW1 / heavy | 31 → 28 | 2/3/0 → 2/2/0 | 1/2 → 1/2 | 1:10/10, 2:5/18 → 1:10/10, 2:3/18 | 0 → 0 | 54.843 → 52.106 | 0 → 0 | 0 → 0 |
| huntress / FLOW1 / full_clear | 28 → 29 | 2/3/0 → 2/2/0 | 1/1 → 1/2 | 1:10/10 → 1:10/10, 2:2/18 | 0 → 0 | 44.365 → 100.626 | 0 → 0 | 0 → 0 |
| huntress / FLOW2 / normal | 31 → 32 | 2/3/0 → 2/2/0 | 1/3 → 1/3 | 1:10/10, 2:15/16, 3:2/18 → 1:10/10, 2:12/16, 3:2/18 | 0 → 0 | 82.972 → 82.18 | 0 → 0 | 0 → 0 |
| huntress / FLOW2 / heavy | 30 → 49 | 2/3/0 → 4/4/0 | 1/2 → 1/2 | 1:10/10, 2:4/18 → 1:10/10, 2:8/18 | 0 → 0 | 55.756 → 88.355 | 0 → 0 | 0 → 0 |
| huntress / FLOW2 / full_clear | 20 → 10 | 0/1/0 → 0/0/0 | 1/1 → 1/1 | 1:10/10 → 1:10/10 | 0 → 0 | 32.308 → 23.568 | 0 → 0 | 0 → 0 |
| huntress / LIVING1 / normal | 15 → 15 | 1/2/0 → 1/1/0 | 1/1 → 1/1 | 1:10/10 → 1:10/10 | 0 → 0 | 20.891 → 22.814 | 0 → 0 | 0 → 0 |
| huntress / LIVING1 / heavy | 26 → 25 | 2/3/0 → 2/2/0 | 1/2 → 1/2 | 1:10/10, 2:1/14 → 1:10/10, 2:1/14 | 0 → 0 | 67.624 → 75.191 | 0 → 0 | 0 → 0 |
| huntress / LIVING1 / full_clear | 14 → 10 | 0/1/0 → 0/0/0 | 1/1 → 1/1 | 1:10/10 → 1:10/10 | 0 → 0 | 18.752 → 17.952 | 0 → 0 | 0 → 0 |

## upgrade-seeking sensitivity

### Full-chapter HP-restored exposure proxies

Ranges cover the three fixed seeds. Artificial HP restoration suppresses healing demand; zero use is not evidence of sufficient or excessive supply.

| Class / route | Completed | Damage HP | Healing found/used/left | Food found/used/left | End Hunger | Starvation HP | Upgrades used |
|---|---:|---:|---|---|---:|---:|---:|
| warrior / normal | 3/3 → 3/3 | 57–84 → 57–84 | 2/0/3 → 4/0/4 | 3–5/1–2/1–4 → 3–5/1–2/1–4 | 82.316–102.067 → 82.316–102.067 | 0 → 0 | 4 → 4 |
| warrior / heavy | 3/3 → 3/3 | 82–93 → 88–93 | 2/0/3 → 8/0/8 | 4–5/2/2–3 → 4–5/2/2–3 | 96.393–116.307 → 96.393–116.307 | 0 → 0 | 4 → 3–4 |
| warrior / full_clear | 3/3 → 3/3 | 69–100 → 75–100 | 2/0/3 → 8/0/8 | 6/5–6/0–1 → 6/5–6/0–1 | 68.392–107.039 → 67.804–107.039 | 0 → 0 | 4 → 3–4 |
| huntress / normal | 3/3 → 3/3 | 71–91 → 71–91 | 2/0/3 → 4/0/4 | 4–5/1–2/2–4 → 4–5/1–2/2–4 | 76.262–99.318 → 76.262–99.318 | 0 → 0 | 4 → 4 |
| huntress / heavy | 3/3 → 3/3 | 93–107 → 91–107 | 2/0/3 → 8/0/8 | 4–5/2/2–3 → 4–5/2/2–3 | 89.625–109.165 → 89.625–108.473 | 0 → 0 | 4 → 3–4 |
| huntress / full_clear | 3/3 → 3/3 | 118–138 → 118–138 | 2/0/3 → 8/0/8 | 4–6/4–5/0–1 → 4–6/4–5/0–1 | 96.537–180 → 96.537–180 | 0 → 0 | 4 → 3–4 |

### Unprotected controls, stopping naturally

F/U/L = acquired healing units / reserved units / remaining units. Reservation can precede death; completed/restored values are in JSON. “Reached floor” is not a completion claim.

| Class / seed / route | Damage HP | Healing F/U/L | Deaths / floor reached | HP entering floors, before → after | Final HP | End Hunger | Food used | Upgrades used |
|---|---:|---|---|---|---:|---:|---:|---:|
| warrior / FLOW1 / normal | 33 → 34 | 3/4/0 → 3/3/0 | 1/3 → 1/3 | 1:10/10, 2:10/18, 3:8/20 → 1:10/10, 2:11/18, 3:9/20 | 0 → 0 | 95.417 → 94.938 | 0 → 0 | 3 → 3 |
| warrior / FLOW1 / heavy | 42 → 76 | 5/6/0 → 8/7/1 | 1/3 → 0/5 | 1:10/10, 2:10/18, 3:9/22 → 1:10/10, 2:11/18, 3:14/22, 4:13/24, 5:16/28 | 0 → 27 | 118.278 → 105.713 | 0 → 2 | 3 → 4 |
| warrior / FLOW1 / full_clear | 14 → 17 | 2/1/2 → 2/2/0 | 1/1 → 1/1 | 1:10/10 → 1:10/10 | 0 → 0 | 46.98 → 47.855 | 0 → 0 | 1 → 1 |
| warrior / FLOW2 / normal | 37 → 43 | 3/4/0 → 3/3/0 | 1/3 → 1/3 | 1:10/10, 2:12/16, 3:10/18 → 1:10/10, 2:13/16, 3:12/18 | 0 → 0 | 77.7 → 85.138 | 1 → 1 | 3 → 3 |
| warrior / FLOW2 / heavy | 42 → 97 | 4/5/0 → 8/8/0 | 1/3 → 0/5 | 1:10/10, 2:14/18, 3:15/20 → 1:10/10, 2:15/18, 3:13/20, 4:15/24, 5:17/28 | 0 → 14 | 96.834 → 65.415 | 1 → 3 | 3 → 4 |
| warrior / FLOW2 / full_clear | 65 → 87 | 8/9/0 → 8/6/2 | 1/4 → 0/5 | 1:10/10, 2:12/18, 3:12/22, 4:10/26 → 1:10/10, 2:12/18, 3:15/22, 4:14/26, 5:21/30 | 0 → 18 | 120.369 → 180 | 4 → 4 | 4 → 4 |
| warrior / LIVING1 / normal | 37 → 44 | 3/4/0 → 3/3/0 | 1/3 → 1/3 | 1:10/10, 2:14/18, 3:8/20 → 1:10/10, 2:11/18, 3:11/20 | 0 → 0 | 112.138 → 114.845 | 0 → 0 | 3 → 3 |
| warrior / LIVING1 / heavy | 43 → 88 | 4/5/0 → 8/7/1 | 1/2 → 0/5 | 1:10/10, 2:11/18 → 1:10/10, 2:18/18, 3:12/22, 4:13/24, 5:18/28 | 0 → 15 | 121.009 → 61.968 | 0 → 3 | 2 → 4 |
| warrior / LIVING1 / full_clear | 53 → 100 | 6/7/0 → 8/8/0 | 1/3 → 0/5 | 1:10/10, 2:12/20, 3:14/22 → 1:10/10, 2:12/20, 3:18/22, 4:20/26, 5:28/30 | 0 → 25 | 120.102 → 104.827 | 2 → 5 | 3 → 4 |
| huntress / FLOW1 / normal | 33 → 34 | 2/3/0 → 2/2/0 | 1/3 → 1/3 | 1:10/10, 2:12/18, 3:8/20 → 1:10/10, 2:13/18, 3:9/20 | 0 → 0 | 86.109 → 85.721 | 0 → 0 | 2 → 2 |
| huntress / FLOW1 / heavy | 36 → 95 | 3/4/0 → 7/7/0 | 1/2 → 1/4 | 1:10/10, 2:11/18 → 1:10/10, 2:10/18, 3:22/22, 4:11/24 | 0 → 0 | 73.245 → 71.487 | 0 → 2 | 2 → 4 |
| huntress / FLOW1 / full_clear | 14 → 28 | 2/1/2 → 2/2/0 | 1/1 → 1/2 | 1:10/10 → 1:10/10, 2:6/18 | 0 → 0 | 46.45 → 111.35 | 0 → 0 | 1 → 1 |
| huntress / FLOW2 / normal | 36 → 31 | 3/4/0 → 2/2/0 | 1/3 → 1/3 | 1:10/10, 2:14/16, 3:6/18 → 1:10/10, 2:7/16, 3:2/18 | 0 → 0 | 77.493 → 69.035 | 1 → 1 | 3 → 3 |
| huntress / FLOW2 / heavy | 48 → 94 | 5/6/0 → 8/8/0 | 1/3 → 0/5 | 1:10/10, 2:16/18, 3:11/20 → 1:10/10, 2:18/18, 3:9/20, 4:22/24, 5:15/28 | 0 → 12 | 93.491 → 112.194 | 1 → 2 | 3 → 4 |
| huntress / FLOW2 / full_clear | 34 → 109 | 3/4/0 → 8/8/0 | 1/2 → 0/5 | 1:10/10, 2:15/18 → 1:10/10, 2:17/18, 3:13/22, 4:26/26, 5:13/30 | 0 → 6 | 73.425 → 67.971 | 2 → 6 | 2 → 4 |
| huntress / LIVING1 / normal | 27 → 28 | 2/3/0 → 2/2/0 | 1/2 → 1/2 | 1:10/10, 2:6/14 → 1:10/10, 2:3/14 | 0 → 0 | 74.424 → 68.057 | 0 → 0 | 2 → 2 |
| huntress / LIVING1 / heavy | 40 → 68 | 4/5/0 → 6/6/0 | 1/2 → 1/4 | 1:10/10, 2:8/14 → 1:10/10, 2:8/14, 3:14/18, 4:3/20 | 0 → 0 | 118.532 → 114.46 | 0 → 1 | 2 → 3 |
| huntress / LIVING1 / full_clear | 39 → 14 | 4/5/0 → 1/1/0 | 1/2 → 1/1 | 1:10/10, 2:7/16 → 1:10/10 | 0 → 0 | 72.397 → 41.003 | 1 → 0 | 2 → 1 |

Raw JSON retains per-floor damage, healing, remaining ground healing, entry/end HP, Hunger, food, gear and bag occupancy. Source SHA-256 sidecars identify the exact measured source.
