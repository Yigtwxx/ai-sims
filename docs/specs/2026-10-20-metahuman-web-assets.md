# MetaHuman web asset contract (2026-10-20)

This file is the contract between the Windows export (`pipeline/unreal/`), the converter (`pipeline/src/asset_pipeline/mh/`) and the web runtime (`web/src/features/avatar/mh/`, `web/src/lib/assets/`). If one side changes a rule here, the others must change too.

## Folders

- **Archive** (Windows PC, `MH_ARCHIVE=C:\Users\Asus\MetaHumanArchive`):
  - `raw/`: Unreal output. Each unit is a folder with a `done.json` (file list, sizes, sha256).
    - `characters/<Name>/`:
      - `dcc/<Name>/`: `head.dna`, `body.dna`, `Maps/*.png` (2K baked), `Masks/*.tga`, `ExportManifest.json`.
      - `dcc_makeup/<Name>/`: makeup-baked maps; only the files that differ from `dcc/`.
      - `textures/face|body/*.png`: full-resolution sources (face 8K, body 4K) and `textures.json`.
      - `settings.json`.
    - `bodies/<female|male>/<variant>/Body_<gender>_Body.dna` and `bodies.json`. Variants: `neutral` plus `<slider>_min|max`.
    - Other units: `grooms/<slot>/<style>/`, `statics/...`, `animations/...`, `lighting/<Level>/`, `materials/...`, `wardrobe/<slot>/`, `fab_import/<package>/`, `outfits/...`.
    - `arkit/arkit_mapping.json`, `inventory.json`.
  - `web/`: converter output, laid out exactly as it is served (see below).
  - Transfer to the Mac (updated 2026-10-21): there is no separate `slim/` copy. `asset-pipeline serve-slim` (`pipeline/src/asset_pipeline/transfer.py`) serves archive folders over the LAN (default `web`, `raw`, `fab_anims`, `gestures`, `logs`), leaving out exported files the converter never reads (`UNUSED_SOURCES`; `--everything` serves them too). `pipeline/scripts/fetch_slim.py` pulls them onto the Mac and downloads byte-identical files once.
- **Web:** `web/public/assets/mh/` is gitignored. It is a link to `MetaHumanArchive/web/` (updated 2026-10-21: a link, not a copy), and the browser loads it from `/assets/mh/...`.

## GLB conventions

- **Space and units:** meters, +Y up. The character faces +Z and stands with its feet at Y = 0.
- **Skeleton:** MetaHuman joint names stay as they are (`root`, `pelvis`, `spine_01`…`spine_05`, `neck_01`, `neck_02`, `head`, `FACIAL_*`, …).
  - Head and body GLBs share joint names.
  - At runtime the head's skin is bound to the body skeleton's bones of the same name. Face-only joints are re-parented under the body `head`.
- **Morph targets** (names are exact; the runtime looks them up by name):
  - The 52 ARKit names, spelled the way Apple spells them: `eyeBlinkLeft`, `eyeLookDownLeft`, …, `jawOpen`, `mouthClose`, …, `tongueOut`.
  - 15 visemes: `viseme_sil`, `viseme_PP`, `viseme_FF`, `viseme_TH`, `viseme_DD`, `viseme_kk`, `viseme_CH`, `viseme_SS`, `viseme_nn`, `viseme_RR`, `viseme_aa`, `viseme_E`, `viseme_I`, `viseme_O`, `viseme_U`. These are the same names `web/src/features/lipsync/mouthDriver.ts` already drives.
  - Body sliders: `body_<slider>_min` and `body_<slider>_max`, for `height`, `weight`, `muscle`, `chest`, `waist`, `hips`, `shoulders`.
- **Eyes:** eyeballs rotate through their joints (`FACIAL_L_Eye`, `FACIAL_R_Eye`). The `eyeLook*` morphs carry only the eyelid follow-through.
- **Materials:** one primitive per DNA mesh. Material names are stable: `head`, `teeth`, `saliva`, `eyeLeft`, `eyeRight`, `eyeshell`, `eyelashes`, `eyeEdge`, `cartilage`, `body`.
- **`extras.mh`** on the scene:
  - `kind`: `head`, `body`, `groom` or `outfit`.
  - `preset`, `gender`, `lod`.
  - `dna_position_index`: maps each glTF vertex to its DNA position index. Groom cards bind to DNA head positions.
  - `neck_seam`: the vertex indices and weights the runtime snaps to the body neck.
  - `animated_maps`: control → wrinkle-map weight table, for wrinkle normals.
  - `body_joint_deltas` (body only): per slider end, the joint translation offsets, so a slider moves the bones too.

## Manifest v2

The manifest lives at `/assets/mh/manifest.json` and is validated by the zod schema in `web/src/lib/assets/manifest.ts`. File paths inside it are relative to `/assets/mh/`.

- **Top level:** `{ version: 2, generatedAt, faces[], skins[], bodies[], grooms[], outfits[], irises[], animations[], lighting[] }`.
- **`faces[]`:** `{ id, label, gender, head, thumbnail, defaultSkin, defaultIris }`.
- **`skins[]`:** `{ id, label, tone, swatch, face: { albedo, normal, cavity, srmf, cm1..3, wm1..3, masks[] }, body: { albedo, normal, cavity, srmf } }`.
  - Every preset's skin can be put on any face, because UVs are shared.
  - `tone` is a 0..1 melanin estimate; the creator sorts skins by it.
- **`bodies[]`:** `{ gender, glb, sliders: [{ id, min, max, default }], presets: { slim, average, athletic, curvy } }`. Each preset is a slider vector. `curvy` is female only (updated 2026-10-21): the male body has `slim`, `average` and `athletic`.
- **`grooms[]`:** `{ id, slot: hair|eyebrows|beard|mustache|eyelashes|peachfuzz, label, thumbnail, glb, textures, params }`.
  - `params` holds the MetaHuman groom parameters (melanin, redness, dye, …) and their defaults.
- **`outfits[]`:** `{ id, category: top|bottom|shoes|full, label, thumbnail, files: { female, male }, params, tintPresets[], hidesBodyRegions[] }`.
- **`irises[]`, `animations[]`, `lighting[]`:** the exported iris textures, playable clips and lighting rigs.

## Outfit GLBs (2026-10-21)

- **File:** one GLB per outfit and gender, `outfits/<id>/<gender>.glb`, fitted to that gender's neutral body.
- **Skinning:** skinned to the body skeleton by joint name, in the body's bind space. At runtime the garment binds to the body's bones and inverse bind matrices, as grooms bind to the head's.
- **Morph targets:** the body slider ends (`body_<slider>_min/max`), transferred from the body. The same slider weights then move the garment with the body.
- **Textures:** outside the GLB as KTX2, as with skins.
  - Per material: normal, AO and the region mask (RGB = regions A/B/C of Unreal's fabric material).
  - Shared tiling detail maps (weave normals, pilling, wrinkles) live once under `outfits/shared/`.
- **`extras.mh` on the scene:**
  - `{ kind: "outfit", id, gender, category, materials, body_hide }`.
  - `materials`: per material name, the fabric parameters the web shader reads: region colours, roughness/specular per region, detail tiling and strengths, and the texture file per slot.
  - `body_hide`: body vertices the garment covers closely enough that skin would poke through. Stored as a base64 bitset over the body primitive's vertex order. The body shader discards surfaces whose vertices are all hidden. It replaces `hidesBodyRegions`, which stays for coarse fallbacks.
- **Colour variants:** variants that differ only in colour share one GLB and become `tintPresets` (region colours).

## Curation

- The curation screen (`/[locale]/curate`) writes `curation.json`, which looks like `{ hidden: string[] }`.
- The creator never shows a hidden id.
- `asset-pipeline mh-prune` (`pipeline/src/asset_pipeline/mh/prune.py`; updated 2026-10-21) deletes the hidden assets from the archive on the machine it runs on: their web outputs, the Unreal export units and Fab packages only they use, and their build stamps. The ids go into `raw/pruned.json`, so the converter skips them, and the manifest is rebuilt. The default is a dry run that prints the plan and a digest; `--apply --plan <digest>` deletes, and only if the plan is still the one shown.
