# SUPERDUNGEON inventory art

25 original, transparent 512 × 512 inventory thumbnails modeled and rendered in Blender 4.3.2. All geometry and procedural materials are created by the accompanying deterministic script; no stock imagery, downloaded models, or third-party textures are used.

## Deliverables

- `../../src/assets/inventory/*.webp`: the 25 optimized runtime assets
- `superdungeon-inventory.blend`: compressed, self-contained editable Blender source with one collection per item and a shared orthographic studio rig
- `contact-sheet.png`: labeled large review sheet; labels sit outside each artwork
- `contact-sheet-112px.png`: actual 112-pixel thumbnail readability review
- `asset-manifest.json`: dimensions, transparency bounds, individual bytes, and total runtime size
- `model-metadata.json`: Blender version, generator, deterministic seed, model counts, and potion palette

## Reproduce

From the repository root, with Blender 4.3.x and Python with Pillow:

```sh
blender -b -t 2 --python scripts/art/render_inventory.py
python scripts/art/package_inventory.py
```

The source file opens with only the longsword collection visible. Enable one named asset collection at a time to inspect its fully editable parts; the generator automatically frames each item for rendering.

To regenerate only selected renders, set `INVENTORY_ASSETS` to a comma-separated list of filename stems. The script still reconstructs and saves the complete editable source scene. Cycles uses 64 samples for textured opaque objects and 512 for glass potions, without requiring optional denoiser libraries. The PNG intermediates and Blender backups are intentionally ignored by Git.

## Visual and gameplay constraints

- Shared three-quarter orthographic framing, soft warm key, cool rim, transparent background, dark steel/ash/leather palette
- Swords, hunting knife, single-sided heavy axe, narrow spear, and simple wooden bow follow the silhouettes and materials in `src/render/viewmodel.ts`
- Cloth quilting, buckled leather panels, and physically modeled interlocked mail links distinguish armor
- All six potions share identical bottle, cork, and cord geometry; **only the liquid color changes**, using the exact source palette `#e0504a`, `#4a78e0`, `#4ec46a`, `#a060e0`, `#e0a040`, `#d8e2e8`
- Unknown scrolls use appearance-only ash, tide, thorn, and star ornaments; no effect names, teleport/map/sleep indicators, or other identification spoilers
- The always-known upgrade scroll has a bronze seal
- The smoke flask has an opaque ceramic and black-iron silhouette clearly distinct from glass potions
- Arrow treatments use the game's blue `#7cc8ff` and violet `#c08cff` visual cues
- No text, numbers, inventory borders, condition meters, or stack counts are baked into runtime images

## Provenance

Created specifically for SUPERDUNGEON by procedural mesh/material construction. Generator seed: `91304`. The script, scene, and rendered assets may be used and modified with the project. There are no external asset attribution requirements.
