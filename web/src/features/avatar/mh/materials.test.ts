import {
  MeshStandardMaterial,
  ShaderLib,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import { describe, expect, it } from 'vitest';

import { BODY_HIDDEN } from './garments';
import { BODY_SKIN, HEAD_SKIN, bodyHideDepthMaterial, createSkinMaterial } from './materials';
import { LEG_HEIGHT, SOCK_TOE_NORMAL, SOCK_TOE_OFFSET } from './socks';

function compiledSkin(tuning: typeof BODY_SKIN) {
  const material = createSkinMaterial(new MeshStandardMaterial(), { microNormal: null }, tuning);
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.physical.vertexShader,
    fragmentShader: ShaderLib.physical.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return { material, shader };
}

describe('createSkinMaterial socks', () => {
  it('draws socks on the body skin by the leg height attribute', () => {
    const { material, shader } = compiledSkin(BODY_SKIN);
    expect(material.defines).toHaveProperty('MH_SOCKS');
    expect(material.userData.sockUniforms).not.toBeNull();
    expect(shader.uniforms).toHaveProperty('skinSockTop');
    expect(shader.vertexShader).toContain(`attribute float ${LEG_HEIGHT};`);
    expect(shader.vertexShader).toContain(`vLegHeight = ${LEG_HEIGHT};`);
    // The fabric stands off the skin, covered vertices only.
    expect(shader.vertexShader).toContain(
      `transformed += sockOut * skinSockThickness * step( ${LEG_HEIGHT}, skinSockTop );`,
    );
    // The toe envelope moves the bind pose and its normal, before the skinning.
    expect(shader.vertexShader).toContain(`transformed += ${SOCK_TOE_OFFSET} * skinSockToes;`);
    expect(shader.vertexShader).toContain(
      `objectNormal = normalize( objectNormal + ${SOCK_TOE_NORMAL} * skinSockToes );`,
    );
    // Every stage got its part: colour, roughness, specular, sheen, scatter, normal.
    for (const part of [
      'sockCloth = sockCover * sockOpacity;',
      'roughnessFactor = mix( roughnessFactor, mix( 0.9, mix( 0.75, 0.55, skinSockSheer ), skinSockNylon ), sockCloth );',
      'specularIntensityFactor = mix( specularIntensityFactor, mix( 0.25, mix( 0.3, 0.5, skinSockSheer ), skinSockNylon ), sockCloth );',
      'material.sheenRoughness = mix(',
      'skinScatter = mix( skinScatter, clothSoft, sockCloth );',
      'mapN = mix( mapN, sockN, sockCloth );',
    ]) {
      expect(shader.fragmentShader).toContain(part);
    }
    expect(material.customProgramCacheKey()).toContain('-socks');
  });

  it('leaves the head skin without socks', () => {
    const { material } = compiledSkin(HEAD_SKIN);
    expect(material.defines).not.toHaveProperty('MH_SOCKS');
    expect(material.userData.sockUniforms).toBeNull();
    expect(material.customProgramCacheKey()).not.toContain('-socks');
  });
});

function compiled(): WebGLProgramParametersWithUniforms {
  const material = bodyHideDepthMaterial();
  const shader = {
    uniforms: {},
    vertexShader: ShaderLib.depth.vertexShader,
    fragmentShader: ShaderLib.depth.fragmentShader,
  } as unknown as WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as WebGLRenderer);
  return shader;
}

describe('bodyHideDepthMaterial', () => {
  it('drops the shadow of skin under worn garments, as the skin drops its colour', () => {
    const shader = compiled();
    expect(bodyHideDepthMaterial().defines).toHaveProperty('MH_BODY_HIDE');
    expect(shader.vertexShader).toContain(`attribute float ${BODY_HIDDEN};`);
    expect(shader.vertexShader).toContain(`vBodyHidden = ${BODY_HIDDEN};`);
    expect(shader.fragmentShader).toContain('if ( vBodyHidden > 0.5 ) discard;');
  });
});
