import { createDefaultConfig } from './defaults';
import { CharacterConfigV1Schema, type CharacterConfigV1 } from './legacy';
import {
  CharacterConfigSchema,
  CURRENT_SCHEMA_VERSION,
  type CharacterConfig,
  type BodySlider,
} from './schema';

/**
 * v1 (anime/VRM) -> v2 (MetaHuman). The parts and faces of v1 do not exist in
 * the MetaHuman library, so only what carries over is kept: base, body build and
 * height, accessories and tattoos. Everything else starts from the defaults and
 * the creator lets the user pick MetaHuman parts again.
 */
function fromV1(v1: CharacterConfigV1): CharacterConfig {
  const config = createDefaultConfig(v1.base);
  const sliders: Partial<Record<BodySlider, number>> = {};
  // v1 height was a 0.92..1.08 scale; map it onto the -1..1 height slider.
  const height = Math.max(-1, Math.min(1, (v1.body.height - 1) / 0.08));
  if (height !== 0) sliders.height = Number(height.toFixed(3));
  config.body = { preset: v1.body.build, sliders };
  config.accessories = [...v1.accessories];
  config.tattoos = v1.tattoos.map((tattoo) => ({ ...tattoo }));
  return config;
}

/**
 * Brings a stored config to the current schema version. Returns null when the
 * value is not a recognizable config of any version (the caller decides whether
 * to hide or repair the document).
 */
export function migrateConfig(raw: unknown): CharacterConfig | null {
  const current = CharacterConfigSchema.safeParse(raw);
  if (current.success) return current.data;

  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version === 1) {
    const v1 = CharacterConfigV1Schema.safeParse(raw);
    if (v1.success) return fromV1(v1.data);
  }
  return null;
}

export { CURRENT_SCHEMA_VERSION };
