import { IrisSchema, SkinSchema, type MhIris, type MhSkin } from '@/lib/assets/manifest';
import { WRINKLE_MASK_LAYERS } from '@/features/avatar/mh/wrinkles';

/** Shared wrinkle masks as the converter wrote them (one folder per mask hash). */
const MASK_DIR = 'skins/masks/b969636bd8b1';

/**
 * Skin set entries over the converter's skins/<id>/ layout, until it writes the
 * real manifest. Body maps come from Ada while other presets' bodies convert.
 * Dev only.
 */
export function benchSkin(id: string): MhSkin {
  return SkinSchema.parse({
    id,
    label: id,
    tone: 0.5,
    swatch: '#8a5a44',
    face: {
      albedo: `skins/${id}/face_albedo.ktx2`,
      normal: `skins/${id}/face_normal.ktx2`,
      srmf: `skins/${id}/face_srmf.ktx2`,
      cavity: `skins/${id}/face_cavity.ktx2`,
      wrinkleColor: [1, 2, 3].map((n) => `skins/${id}/face_cm${n}.ktx2`),
      wrinkleNormal: [1, 2, 3].map((n) => `skins/${id}/face_wm${n}.ktx2`),
      wrinkleMasks: WRINKLE_MASK_LAYERS.map((layer) => `${MASK_DIR}/${layer}.ktx2`),
    },
    body: {
      albedo: 'skins/Ada/body_albedo.ktx2',
      normal: 'skins/Ada/body_normal.ktx2',
      srmf: 'skins/Ada/body_srmf.ktx2',
      cavity: 'skins/Ada/body_cavity.ktx2',
    },
    makeupAlbedo: `skins/${id}/face_albedo_makeup.ktx2`,
  });
}

/** Iris entry over the converter's irises/<id>/ layout. Dev only. */
export function benchIris(id: string): MhIris {
  return IrisSchema.parse({
    id,
    label: id,
    color: `irises/${id}/color.ktx2`,
    normal: `irises/${id}/normal.ktx2`,
    swatch: '#6b4a2a',
  });
}
