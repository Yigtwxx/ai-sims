// Loads converter GLBs with the web app's own three.js GLTFLoader + MeshoptDecoder in Node
// (no WebGL): proves the files parse the way the browser will read them.
//   node scripts/check_glb_three.mjs <web dir with node_modules> <file.glb> [...]
// KTX2 textures are stubbed (they need a GPU to transcode); everything else is real.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [webArgument, ...files] = process.argv.slice(2);
const webDir = webArgument ? resolve(webArgument) : '';
if (!webArgument || files.length === 0) {
  console.error('usage: check_glb_three.mjs <web dir> <file.glb> [...]');
  process.exit(2);
}
// GLTFLoader reads `self` (image decoding) even when every texture is KTX2.
globalThis.self ??= globalThis;
const three = await import(
  pathToFileURL(join(webDir, 'node_modules/three/build/three.module.js')).href
);
const { GLTFLoader } = await import(
  pathToFileURL(join(webDir, 'node_modules/three/examples/jsm/loaders/GLTFLoader.js')).href
);
const { MeshoptDecoder } = await import(
  pathToFileURL(join(webDir, 'node_modules/three/examples/jsm/libs/meshopt_decoder.module.js')).href
);

// Minimal KTX2 stand-in: GLTFLoader only needs `load()` to hand back a texture.
class StubKTX2 {
  load(url, onLoad) {
    const texture = new three.Texture();
    texture.userData.url = url;
    onLoad(texture);
    return texture;
  }
}

let failed = false;
for (const file of files) {
  const data = readFileSync(file);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.setKTX2Loader(new StubKTX2());
  await MeshoptDecoder.ready;
  try {
    const gltf = await loader.parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      pathToFileURL(file).href.replace(/[^/]*$/, ''),
    );
    const report = { file, meshes: [], animations: [], bones: 0 };
    gltf.scene.traverse((node) => {
      if (node.isBone) report.bones += 1;
      if (!node.isMesh) return;
      const geometry = node.geometry;
      const position = geometry.getAttribute('position');
      const normal = geometry.getAttribute('normal');
      const weights = geometry.getAttribute('skinWeight');
      let worstWeightSum = 0;
      if (weights) {
        for (let i = 0; i < weights.count; i += 1) {
          const sum = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
          worstWeightSum = Math.max(worstWeightSum, Math.abs(sum - 1));
        }
      }
      let worstNormal = 0;
      if (normal) {
        for (let i = 0; i < normal.count; i += 1) {
          const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
          worstNormal = Math.max(worstNormal, Math.abs(length - 1));
        }
      }
      const morphs = geometry.morphAttributes.position ?? [];
      let largestMorph = 0;
      for (const morph of morphs) {
        for (let i = 0; i < morph.count; i += 1) {
          largestMorph = Math.max(
            largestMorph,
            Math.abs(morph.getX(i)),
            Math.abs(morph.getY(i)),
            Math.abs(morph.getZ(i)),
          );
        }
      }
      geometry.computeBoundingBox();
      report.meshes.push({
        name: node.name,
        material: Array.isArray(node.material) ? node.material.map((m) => m.name) : node.material.name,
        vertices: position.count,
        skinned: Boolean(node.isSkinnedMesh),
        morphs: morphs.length,
        largestMorphDelta: Number(largestMorph.toFixed(4)),
        worstNormalLength: Number(worstNormal.toFixed(4)),
        worstWeightSum: Number(worstWeightSum.toFixed(5)),
        attributes: Object.keys(geometry.attributes),
        bboxY: [geometry.boundingBox.min.y, geometry.boundingBox.max.y].map((v) => Number(v.toFixed(3))),
      });
    }
    );
    for (const clip of gltf.animations) {
      report.animations.push({ name: clip.name, duration: Number(clip.duration.toFixed(3)), tracks: clip.tracks.length });
    }
    console.log(JSON.stringify(report));
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ file, error: String(error) }));
  }
}
process.exit(failed ? 1 : 0);
