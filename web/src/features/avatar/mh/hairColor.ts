/**
 * Unreal's hair colour model (the MetaHuman groom "Melanin / Redness / Dye"
 * parameters): melanin concentrations become an absorption coefficient, a dye
 * adds its own absorption, and the sum maps back to a reflectance colour.
 * Absorption <-> colour uses the fit from Chiang et al. 2016 with azimuthal
 * roughness 0.3, as Unreal does. The shader carries the same maths (HAIR_COLOR_GLSL)
 * so each strand can vary around the configured values.
 */

export type Rgb = [number, number, number];

/** Absorption per unit of eumelanin (dark brown/black) and pheomelanin (red). */
export const EUMELANIN: Rgb = [0.506, 0.841, 1.653];
export const PHEOMELANIN: Rgb = [0.343, 0.733, 1.924];

const ROUGHNESS = 0.3;
const FIT =
  5.969 -
  0.215 * ROUGHNESS +
  2.532 * ROUGHNESS ** 2 -
  10.73 * ROUGHNESS ** 3 +
  5.574 * ROUGHNESS ** 4 +
  0.245 * ROUGHNESS ** 5;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function absorptionToColor(absorption: Rgb): Rgb {
  return absorption.map((a) => Math.exp(-Math.sqrt(Math.max(a, 0)) * FIT)) as Rgb;
}

/** Inverse of absorptionToColor for a linear colour (white absorbs nothing). */
export function colorToAbsorption(color: Rgb): Rgb {
  return color.map((c) => (Math.log(Math.max(clamp01(c), 1e-4)) / FIT) ** 2) as Rgb;
}

export function melaninAbsorption(melanin: number, redness: number): Rgb {
  const concentration = -Math.log(Math.max(1 - clamp01(melanin), 1e-4));
  const eu = concentration * (1 - clamp01(redness));
  const pheo = concentration * clamp01(redness);
  return [0, 1, 2].map((i) => eu * EUMELANIN[i]! + pheo * PHEOMELANIN[i]!) as Rgb;
}

/** Linear reflectance colour of hair with the given melanin, redness and optional dye. */
export function hairColor(melanin: number, redness: number, dye: Rgb | null = null): Rgb {
  const absorption = melaninAbsorption(melanin, redness);
  const dyed = dye ? colorToAbsorption(dye) : [0, 0, 0];
  return absorptionToColor(absorption.map((a, i) => a + dyed[i]!) as Rgb);
}

/** GLSL twin of melaninAbsorption + absorptionToColor (FIT and pigments as uniforms-free constants). */
export const HAIR_COLOR_GLSL = /* glsl */ `
vec3 hairAbsorption( float melanin, float redness ) {
  float concentration = -log( max( 1.0 - saturate( melanin ), 1e-4 ) );
  return concentration * ( 1.0 - saturate( redness ) ) * vec3( ${EUMELANIN.join(', ')} )
    + concentration * saturate( redness ) * vec3( ${PHEOMELANIN.join(', ')} );
}
vec3 hairAbsorptionToColor( vec3 absorption ) {
  return exp( -sqrt( max( absorption, vec3( 0.0 ) ) ) * ${FIT.toFixed(6)} );
}
`;
