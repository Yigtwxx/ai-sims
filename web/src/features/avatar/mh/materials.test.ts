import { ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';

import { BODY_HIDDEN } from './garments';
import { bodyHideDepthMaterial } from './materials';

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
