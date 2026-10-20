import {
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  WebGLArrayRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';

/**
 * Copies same-sized mask textures (any format, KTX2 included) into one 2D
 * array on the GPU, so the skin shader reads ten wrinkle masks through a single
 * texture unit (WebGL guarantees only 16 per fragment shader). Texel (u, v)
 * of each layer equals texel (u, v) of its source, so the mesh UVs apply as is.
 */
export function packMaskArray(
  renderer: WebGLRenderer,
  masks: readonly Texture[],
  size = 256,
): WebGLArrayRenderTarget {
  const target = new WebGLArrayRenderTarget(size, size, masks.length, {
    format: RGBAFormat,
    type: UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  });
  const material = new ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4( position.xy, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() { gl_FragColor = texture2D( map, vUv ); }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const camera = new OrthographicCamera();
  const previous = renderer.getRenderTarget();
  masks.forEach((mask, layer) => {
    material.uniforms.map!.value = mask;
    renderer.setRenderTarget(target, layer);
    renderer.render(quad, camera);
  });
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  material.dispose();
  return target;
}
