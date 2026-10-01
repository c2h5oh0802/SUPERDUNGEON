# Intact inventory drops and conservative healing supply

Status: Ready for Human Review. Based on source matching remote commit
`02e79d487731647a0370ab2b6aea7c15f46053b2`. Work and checks ran in the dot cloud;
the user's computer was not used.

## Player-facing behavior

- Every bag item has **放下**; a stack additionally offers **放下 1 個** and
  **全部放下（N）**. Potion **丟出** remains the separate, destructive thrown-bottle action.
- Choosing a drop closes the bag and starts an ordinary 0.3-world-second action
  (0.15 with Haste). The item is transferred intact at action start, followed by
  committed recovery. Menus still pause the world; repeated menu clicks cannot
  drop unlimited items without advancing time.
- The exact quantity and upgrade level remain at the player's feet. Unknown
  items remain unknown and retain the same appearance. Dropping never drinks,
  reads, equips, converts, heals, identifies or triggers a potion effect.
- A deliberate drop stays on the ground while the player is within its 0.9 m
  pickup radius. Walk away and return to collect it. Other nearby loot can fill
  the newly opened slot immediately.
- Re-pickup takes only what fits; any remainder stays on the floor. Existing
  consumable cap 99, ration cap, 10-slot bag, and legacy 11-slot Healing overflow
  rules remain. Placing only one item from a larger stack does not free its slot.
- Only held items cross floors. Retrieve anything wanted before descending.
  Existing saves remain floor-start checkpoints, not mid-floor world snapshots;
  quitting/reloading restarts that floor under the existing checkpoint policy.

No permanent delete action was added. Equipment currently worn is unaffected;
the controls act on bag contents. Existing equipment swaps and their full-bag
fallback remain unchanged.

## Safety details

Queued actions remember the selected runtime stack, rather than trusting an
index that might now contain something else. A vanished selection is canceled;
an index-shifted selection still targets the same stack. A drop waits for an
existing action, and cannot copy its already-reserved consumable.

The inventory-to-ground transfer is atomic. Being stunned or killed during the
recovery does not create a refund, duplicate or lost reserved item. Dropped
Healing is tagged so recovering it never increments `healingFound`; it also does
not increase use, restoration or waste statistics.

## Healing trial

The separately documented [supply v2](healing-supply-v2.md) changes fixed chapter
opportunities from 12 to 9: **3/2/2/2/0** by floor. Floor 1 remains unchanged.
Later floors lose one fixed sentry-chest bottle each, preserving the loose source
and ember-cache chest source. Random rolls, 50%-maximum-HP healing, food,
upgrades, enemy drops and practice supplies retain their rules.

This is a provisional, conservative response to surplus bottles. It does not
promise a particular number remaining, and lowering a stack's count does not
by itself relieve bag-slot pressure. Archer mobility/HP and smoke were inspected
but were not changed in this pass.

## Verification

- Baseline: 587 tests across 32 files passed.
- Final: 633 tests across 34 files passed; typecheck, lint, build and diff checks passed.
- New persistent coverage: 21 drop tests and 25 supply tests. Drop cases include
  both classes, one/all, 99-stacks and ration partial pickup, stale/shifted
  selections, a queued drink, full-health/unknown Healing, interruption/death,
  full bags, migrated overflow, old +5 gear, floor/save boundaries, paid timing
  and presentation. Supply tests include historical full-level fingerprints,
  RNG counts, both layouts/mirrors, reachability and a retained random Healing roll.
- Independent read-only review found no blocking issue, including extra runtime
  checks across 28 item/drop/Haste combinations.
- All 30 existing encounter policy results reproduce exactly.
- Fresh seeded supply census: FLOW1 **16→13**, FLOW2 **14→11**, LIVING1 **14→11**
  total generated Healing bottles, including random rolls.
- The existing 36-route Healing harness was rerun against both versions. All 18
  protected exposure proxies still complete; their damage, food, Hunger and time
  remain unchanged. The 12 protected side-room routes acquire three fewer
  bottles; six main-route proxies are unchanged. All 18 unprotected simplistic
  controllers die before and after, with 11 Floor-1 deaths unchanged; four Warrior
  side-room controls change, including three earlier-floor deaths. These results
  expose the reduction's cost, and do not establish human balance or fun. The bot
  does not exercise the new drop action. See [paired measurements and source hashes](drop-healing-measurements.json).
- `node --check e2e/inventory-drop.mjs` passed. The script uses disclosed
  debug-created inventory and relocation, then real bag buttons and action clocks.
- All 15 E2E scripts were blocked before page assertions. The default Playwright
  binary is missing; the installed system Chromium fails at startup with
  `socket() failed: Operation not permitted`. No browser assertion or visual
  layout verification is claimed. Vite starts and an in-process HTTP request returns 200.

Reproduce the route census with `HARNESS=supply.mjs node
scripts/healing-calibration/run-calibration.mjs <source> <output.json>` and the
paired route controls with the same command without `HARNESS`. Before source is
the commit above; after source is this change. The raw harness methodology and
limitations remain in [Healing calibration methodology](healing-baselines/METHODOLOGY.md).

## Human review route

1. With a full bag, place one unwanted upgraded weapon; pick up the desired nearby
   item. Confirm the old weapon remains at your feet and retains its level.
2. Place one bottle from a stack, then the rest. Confirm the first operation leaves
   the slot occupied and the second frees it. Wait in place; no re-pickup should occur.
3. Walk a little over one metre away and return. Recover the stack; if the bag is
   full, free a real slot and return again. Check unknown names/colors and Healing
   found/used statistics remain unchanged by this loop.
4. Open/close the bag repeatedly and use a short window. Reach the last item's
   drop button and Close control without getting stuck. Confirm recovery advances
   enemies/Hunger while the open menu pauses them.
5. Retrieve wanted gear before descending. Continue an old full-bag save and verify
   its Healing, equipment levels and knowledge remain usable.
6. Replay one recorded seed normally. Keep Floor 1 as a control; on Floors 2–4
   note bottles found/used/left, dangerous low-HP moments and bag-full interruptions.
   Use that evidence for the next supply decision instead of forcing an end-stock target.
