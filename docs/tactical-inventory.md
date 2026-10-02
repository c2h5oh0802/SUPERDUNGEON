# Tactical inventory presentation

Implemented after the Heart Warden on the source tree of remote commit
`2439b927caa014e7c35006744d2d435442db9e23`. This is an original dark-fantasy field-kit
presentation inspired by the clarity of equipment-and-grid inventories.

## Player-facing changes

- Illustrated bag slots, currently equipped melee weapon/armor/Huntress bow, and a
  selected-item inspection panel replace the long text list.
- Selecting an item is free and keeps the world paused. Use/equip/throw/convert/drop
  remain separate explicit buttons and go through the existing queued action route.
- Ten equal logical bag slots remain ten slots. Same-type consumable stacks, counts,
  upgrade levels, exact equipment comparisons, and the saved item format are unchanged.
  A migrated eleventh item remains visible and usable, with an overflow explanation.
- Smoke bottles, ordinary arrows, tipped arrows, and stones appear separately as
  existing carried-stock counters. They do not become extra bag items or new equipment.
- Unknown potions use the run's seeded color appearance, and unknown scrolls use its
  seeded rune appearance. Images, image URLs, names, accessibility labels, and actions
  never reveal their hidden effect. Identifying an item does not change its image.
- Full-health known Healing, full Hunger, upgrade caps, and Frost/Gas conversion
  eligibility continue using the existing rules and explanatory disabled controls.
- Dropping one or all remains intact placement at the feet, with the same paid action,
  re-pickup gating, knowledge, quantities, and carried-across-floors rules.
- Native Tab/Space/Enter, wheel scrolling, visible focus, dialog focus wrapping, and
  I/Escape closing work through inventory-scoped input routing. Gameplay keys and
  canvas fire/look cannot be buffered while the inventory is open. Input is cleared
  specifically when returning from inventory, without changing map/choice routing.
- Narrow layouts place the bag first; selection brings the inspector into view and
  focuses its heading. “返回背包格” restores focus to the selected slot. Equipped gear
  remains below. The close control stays in the panel footer.

No new packing, rotation, weight, durability, sorting, loot, combat, or save mechanics
were introduced. No player computer was used.

## Original art

25 original 512×512 transparent WebP images cover four melee weapons, three armors,
Huntress bow, ration, six potion appearances, four seeded scroll appearances plus the
known upgrade scroll, and five stock illustrations. All are modeled and rendered in
Blender, using original geometry/procedural materials and a shared studio rig.

The compressed editable source, deterministic render/package scripts, byte manifest,
provenance, and large/112px review sheets are in [the art package](../art/inventory/README.md).
Runtime assets are bundled by Vite using relative deployment paths. The game does not
load Blender or a new 3D renderer for this UI.

## Verification

- TypeScript, ESLint, 831 tests across 43 files, production build, and whitespace checks pass.
- 47 new presentation tests cover all item IDs/assets, 48 seeds across both appearance
  versions, unknown HTML/ARIA/asset leakage, stable art after identification, full and
  empty bags, real migrated overflow, counts, duplicate upgrades, stale selections,
  double dispatch, mobile inspector/return focus, and visible-only focus wrapping.
- 20 new input tests cover native menu keys/wheel, close shortcuts, repeat suppression,
  canvas gating, cleared state, and unchanged gameplay/map/choice routing.
- All existing inventory-related browser scripts were adapted to select a tile before
  using its inspector, preserving their assertions. The new
  `e2e/inventory-presentation.mjs` adds 1280×720, 860×480, and 390×844 contracts.
- All 17 aggregate browser scripts were attempted but stop before assertions because
  this cloud container's Chromium cannot create its process socket (`EPERM`). The
  separately available cloud browser opens the public site but has WebGL disabled;
  the already-live Boss build fails during renderer initialization there. Neither
  route establishes a passed gameplay/browser test, and no graphics/security setting
  was changed to work around it.
- Independent read-only review found no blocking knowledge, action, capacity, art,
  input, or static visual issue. Its small mobile max-height specificity finding was
  corrected. Final image decoding, dimensions, transparent margins, and manifest
  coverage are checked separately from browser rendering.

## Supporting visual preview

`node scripts/inventory-preview.mjs` exports the actual UI renderer's HTML and CSS
with a disclosed synthetic item fixture. Its output is a **static interface preview,
not a gameplay screenshot**. Explicit print-only dimensions accommodate PDF renderers
that lack viewport/aspect-ratio behavior. It supports visual review; it does not verify
native browser layout, pointer behavior, gameplay, or human usability.

## Recheck in a WebGL-capable browser

1. Open both class bags, select every item, inspect gear/stock, and close with I/Escape.
2. Tab through the visible controls, use Enter/Space, and verify focus stays in the
   dialog. At phone width, select a tile and return using the inspector's button.
3. Use/drink/read/equip and known conversions; check blocked states keep the item.
4. Drop one, then an entire stack; walk away and return to recover it intact.
5. Verify world time/Hunger stop during inspection and existing paid actions resume
   normally after closing. Repeated opening/closing must not move or attack.
6. Continue a supported legacy overflow save and reach its eleventh item's controls.
