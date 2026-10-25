// Sprite3D prototype renderer module (#15). Loaded by page.html, driven via window.__sprite3d.
// Renders one rigged GLB animation pose to a 64x64 isometric pixel-art frame:
// fixed orthographic camera at the game's 2:1 isometric elevation, toon shading,
// binary alpha, <=24 colours and a 1px near-black outline.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SIZE = 64; // render size in pixels, matches the courier frames
const FIGURE_H_PX = 44; // target figure height in pixels
const FEET_ROW = 55; // courier baseline: lowest feet pixel row (0 = top)
const OUTLINE = [0x0b, 0x08, 0x08]; // near-black outline, matches the courier
const MAX_COLORS = 24;

// Orthographic view direction: horizontal (1,1)/sqrt(2) (from target toward camera),
// elevation atan(0.5) => the game's 2:1 isometric ground. (Round 1 used (1,1,0.5),
// which normalizes to elevation ~42°, not atan(0.5) ~26.6° — horizontal limbs
// projected at ~53° and figures read as tilted. (1, 0.707, 1) is the true 2:1 angle.)
const VIEW_DIR = new THREE.Vector3(1, Math.SQRT1_2, 1).normalize();

let renderer, scene, camera, pivot, mixer, clipsByName;
// Fixed framing per model (computed once from the loaded model's bounds) so all
// frames of a character share the same camera and don't jitter between poses.
let framing = null;

function init() {
  const stage = document.getElementById("stage");
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0x000000, 0);
  stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);

  // 3-step gradient map for MeshToonMaterial, sampled with NearestFilter. Round 2:
  // darker first step than round 1 ([100, 180, 255]) so the three tones read apart.
  const steps = [80, 170, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const gradientMap = new THREE.DataTexture(data, steps.length, 1);
  gradientMap.minFilter = THREE.NearestFilter;
  gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  scene.userData.gradientMap = gradientMap;

  // Key light from the screen's upper left (world (+x, -y, +z) is screen-left + up).
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, -2, 3);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));

  pivot = new THREE.Group();
  scene.add(pivot);
}

function toonMaterial(src) {
  const mat = new THREE.MeshToonMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    map: src.map || null,
    gradientMap: scene.userData.gradientMap,
  });
  if (src.map) {
    src.map.minFilter = THREE.NearestFilter;
    src.map.magFilter = THREE.NearestFilter;
  }
  return mat;
}

// Bind a separately-loaded skinned hair mesh to the body's skeleton. Both files share
// the exact same 65 bone names (Quaternius rigs) and both armatures sit at identity,
// so the hair's own inverse bind matrices stay valid when its bones are swapped for
// the body's — matched by name, in the hair skeleton's order.
async function attachHair(model, url) {
  const hairGltf = await new GLTFLoader().loadAsync(url);
  let hairMesh = null;
  hairGltf.scene.traverse((obj) => {
    if (!hairMesh && obj.isSkinnedMesh) hairMesh = obj;
  });
  if (!hairMesh) throw new Error(`no skinned mesh in hair file ${url}`);
  let bodySkin = null;
  model.traverse((obj) => {
    if (!bodySkin && obj.isSkinnedMesh) bodySkin = obj;
  });
  if (!bodySkin) throw new Error("body model has no skinned mesh to bind hair to");
  const bodyBones = new Map(bodySkin.skeleton.bones.map((b) => [b.name, b]));
  const bones = hairMesh.skeleton.bones.map((b) => {
    const match = bodyBones.get(b.name);
    if (!match) throw new Error(`hair bone "${b.name}" has no match on the body skeleton`);
    return match;
  });
  hairMesh.frustumCulled = false; // skinned bounds don't track the deformed shape
  hairMesh.bind(new THREE.Skeleton(bones, hairMesh.skeleton.boneInverses), hairMesh.bindMatrix);
  hairMesh.userData.isHair = true;
  model.add(hairMesh);
  return hairMesh;
}

// Turn a style recipe (styles.js) into vertex colours: every vertex of a skinned body
// mesh takes the colour of the region its dominant (highest-weight) skinning bone maps
// to. Eyes keep their texture; eyebrows and hair take flat recipe colours.
function styleModel(model, recipe) {
  const regionFor = (boneName) => {
    for (const [prefix, region] of recipe.boneMap) {
      if (boneName.startsWith(prefix)) return region;
    }
    return "skin";
  };
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.isHair) {
      obj.material = toonMaterial(obj.material);
      obj.material.color.set(recipe.regions.hair);
      obj.material.map = null;
      return;
    }
    if (obj.name.startsWith("Eyebrows")) {
      obj.material = toonMaterial(obj.material);
      obj.material.color.set(recipe.eyebrowColor);
      obj.material.map = null;
      return;
    }
    if (obj.name === "Eyes") return; // keep the eye texture
    if (!(obj.isSkinnedMesh && obj.geometry.attributes.skinIndex)) return;
    const bones = obj.skeleton.bones;
    const geo = obj.geometry;
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const si = geo.attributes.skinIndex;
    const sw = geo.attributes.skinWeight;
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      let best = 0;
      let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bestW) {
          bestW = w;
          best = si.getComponent(i, k);
        }
      }
      const region = regionFor(bones[best] ? bones[best].name : "");
      c.set(recipe.regions[region] ?? recipe.regions.skin);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = toonMaterial(obj.material);
    mat.vertexColors = true;
    mat.map = null; // the skin texture would muddy the recipe colours
    obj.material = mat;
  });
}

async function load(url, opts = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;

  // Replace every material with a toon material, keeping colour/texture.
  let replaced = 0;
  model.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      if (Array.isArray(obj.material)) {
        throw new Error(`multi-material mesh ${obj.name}: not supported in this prototype`);
      }
      obj.material = toonMaterial(obj.material);
      replaced++;
    }
  });

  // Round 2: attach the hairstyle, then paint the style recipe onto the mesh.
  if (opts.hairUrl) await attachHair(model, opts.hairUrl);
  if (opts.recipe) styleModel(model, opts.recipe);

  // Centre the model's horizontal bounds on the pivot so rotation keeps it centred,
  // and stand it on y=0 so the camera framing can put the feet on FEET_ROW.
  const box = new THREE.Box3().setFromObject(model);
  if (box.isEmpty()) throw new Error("model has an empty bounding box");
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const feetY = box.min.y;
  const height = box.max.y - box.min.y;
  model.position.set(-cx, -feetY, -cz);

  pivot.clear();
  pivot.add(model);
  pivot.rotation.y = 0;

  // Round 2: the animation library is a separate glb; its clips share the same skeleton
  // and bone names as the body, so the mixer plays them on the body directly.
  let animations = gltf.animations;
  let animSource = url;
  if (opts.animUrl) {
    const animGltf = await new GLTFLoader().loadAsync(opts.animUrl);
    animations = animGltf.animations;
    animSource = opts.animUrl;
  }

  mixer = new THREE.AnimationMixer(model);
  clipsByName = new Map();
  for (const clip of animations) {
    if (!clipsByName.has(clip.name)) clipsByName.set(clip.name, clip);
  }

  // Fixed framing: pixelsPerUnit from the figure height, camera centre placed so the
  // feet project onto FEET_ROW and the figure is horizontally centred.
  const pps = FIGURE_H_PX / height;
  const half = SIZE / 2 / pps;
  camera.left = -half;
  camera.right = half;
  camera.top = half;
  camera.bottom = -half;
  // Model stands on y=0 (see load()), so the feet land on the FEET_ROW/FEET_ROW+1 pixel boundary.
  const centerY = (FEET_ROW + 1 - SIZE / 2) / pps;
  framing = { centerY, targetX: 0, targetZ: 0, height };
  applyCamera();

  return {
    clips: [...clipsByName.keys()],
    durations: Object.fromEntries([...clipsByName].map(([name, clip]) => [name, clip.duration])),
    animSource,
    height,
    materialsReplaced: replaced,
  };
}

function setPose(clipName, t, yawDeg) {
  const clip = clipsByName.get(clipName);
  if (!clip) throw new Error(`no clip named "${clipName}" (have: ${[...clipsByName.keys()].join(", ")})`);
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  action.time = Math.min(Math.max(t, 0), clip.duration);
  mixer.update(0);
  pivot.rotation.y = (yawDeg * Math.PI) / 180;
}

// --- post-pass: binary alpha, <=24 colours, 1px outline -------------------------

function quantizeMedianCut(pixels, maxColors) {
  // pixels: array of [r, g, b]. Returns map from rgb key -> [r, g, b].
  let boxes = [pixels];
  while (boxes.length < maxColors) {
    let best = -1;
    let bestRange = 0;
    let bestChannel = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let min = 255;
        let max = 0;
        for (const p of box) {
          if (p[c] < min) min = p[c];
          if (p[c] > max) max = p[c];
        }
        if (max - min > bestRange) {
          bestRange = max - min;
          best = i;
          bestChannel = c;
        }
      }
    }
    if (best < 0 || bestRange === 0) break;
    const box = boxes[best].slice().sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(box.length / 2);
    boxes = boxes.filter((_, i) => i !== best).concat([box.slice(0, mid), box.slice(mid)]);
  }
  const palette = new Map();
  for (const box of boxes) {
    const sum = [0, 0, 0];
    for (const p of box) {
      sum[0] += p[0];
      sum[1] += p[1];
      sum[2] += p[2];
    }
    const avg = sum.map((s) => Math.round(s / box.length));
    for (const p of box) palette.set((p[0] << 16) | (p[1] << 8) | p[2], avg);
  }
  return palette;
}

const work = document.createElement("canvas");
work.width = SIZE;
work.height = SIZE;
const workCtx = work.getContext("2d", { willReadFrequently: true });

function postProcess() {
  workCtx.clearRect(0, 0, SIZE, SIZE);
  workCtx.drawImage(renderer.domElement, 0, 0);
  const img = workCtx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;

  // Binary alpha.
  const opaque = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < opaque.length; i++) {
    opaque[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  }

  // Reduce to <=24 colours over the opaque pixels.
  const colors = new Map();
  for (let i = 0; i < opaque.length; i++) {
    if (!opaque[i]) continue;
    const o = i * 4;
    const key = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  if (colors.size > MAX_COLORS) {
    const pixels = [...colors.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    const palette = quantizeMedianCut(pixels, MAX_COLORS);
    for (let i = 0; i < opaque.length; i++) {
      if (!opaque[i]) continue;
      const o = i * 4;
      const key = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
      const mapped = palette.get(key);
      d[o] = mapped[0];
      d[o + 1] = mapped[1];
      d[o + 2] = mapped[2];
    }
  }

  // 1px outline: transparent pixels touching an opaque pixel (4-neighbourhood).
  const outlined = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if (opaque[i]) continue;
      const n =
        (x > 0 && opaque[i - 1]) ||
        (x < SIZE - 1 && opaque[i + 1]) ||
        (y > 0 && opaque[i - SIZE]) ||
        (y < SIZE - 1 && opaque[i + SIZE]);
      if (n) outlined[i] = 1;
    }
  }
  for (let i = 0; i < outlined.length; i++) {
    const o = i * 4;
    if (outlined[i]) {
      d[o] = OUTLINE[0];
      d[o + 1] = OUTLINE[1];
      d[o + 2] = OUTLINE[2];
      d[o + 3] = 255;
    } else if (!opaque[i]) {
      d[o + 3] = 0;
    }
  }
  workCtx.putImageData(img, 0, 0);
  return work;
}

// --- public API -----------------------------------------------------------------

// Calibrate the fixed framing against a rendered pose: scale so the opaque silhouette
// (including the 1px outline) is TARGET_H px tall, feet on row TARGET_BOTTOM, and
// horizontally centred at px 32 — matching the courier (opaque x[23,40] y[10,55]).
// Iterates because scale and shift interact. yawDeg=45 is the frontal (toward-viewer) pose.
const TARGET_BOTTOM = 55;
const TARGET_H = 46;

function calibrate(clipName, yawDeg = 45) {
  let info = null;
  for (let iter = 0; iter < 6; iter++) {
    setPose(clipName, 0, yawDeg);
    renderer.render(scene, camera);
    postProcess();
    const d = workCtx.getImageData(0, 0, SIZE, SIZE).data;
    let minx = SIZE, maxx = -1, miny = SIZE, maxy = -1;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (d[(y * SIZE + x) * 4 + 3] > 0) {
          if (x < minx) minx = x;
          if (x > maxx) maxx = x;
          if (y < miny) miny = y;
          if (y > maxy) maxy = y;
        }
      }
    }
    if (maxy < 0) throw new Error("calibration render is empty");
    info = { minx, maxx, miny, maxy };
    const h = maxy - miny + 1;
    if (h === TARGET_H && maxy === TARGET_BOTTOM && Math.round((minx + maxx + 1) / 2) === 32) break;

    const f = TARGET_H / h;
    const cx = (minx + maxx + 1) / 2;
    // Rescale about the screen centre, then the residual shifts (in the new pixel scale).
    const feetRow = 32 + (maxy - 32) * f;
    const cxNew = 32 + (cx - 32) * f;
    const dy = feetRow - TARGET_BOTTOM; // >0: image too low, move up
    const dx = cxNew - 32; // >0: image too right, move left
    const pps = SIZE / 2 / camera.top;
    camera.top = SIZE / 2 / (pps * f); // top = (SIZE/2)/ppsNew
    camera.bottom = -camera.top;
    camera.left = -camera.top;
    camera.right = camera.top;
    framing.centerY -= dy / (pps * f);
    // Screen-right axis r = (-1,+1)/sqrt(2); moving the target along +r shifts the image left.
    const along = dx / (pps * f);
    framing.targetX -= along * -Math.SQRT1_2;
    framing.targetZ -= along * Math.SQRT1_2;
    applyCamera();
  }
  return info;
}

function applyCamera() {
  const target = new THREE.Vector3(framing.targetX, framing.centerY, framing.targetZ);
  camera.position.copy(VIEW_DIR).multiplyScalar(100).add(target);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function renderFrame(clipName, t, yawDeg) {
  setPose(clipName, t, yawDeg);
  renderer.render(scene, camera);
  const frame = postProcess();
  // Copy to a fresh canvas: `work` is reused between frames.
  const out = document.createElement("canvas");
  out.width = SIZE;
  out.height = SIZE;
  out.getContext("2d").drawImage(frame, 0, 0);
  return out;
}

// Compose cells onto a canvas and return a PNG dataURL. cells: [{src, dx, dy, w, h}]
// where src is a dataURL or a server URL. scale > 1 uses nearest-neighbour only.
// bg (a CSS colour) fills the canvas first; without it the canvas stays transparent.
async function compose(cells, width, height, scale, bg) {
  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const cell of cells) {
    const img = new Image();
    img.src = cell.src;
    await img.decode();
    ctx.drawImage(img, cell.dx * scale, cell.dy * scale, cell.w * scale, cell.h * scale);
  }
  return canvas.toDataURL("image/png");
}

window.__sprite3d = { init, load, calibrate, renderFrame, compose };

// Debug hook: world positions of a few named bones (rest pose, after load()).
window.__sprite3d.debugBones = (names) => {
  const out = {};
  scene.traverse((obj) => {
    if (obj.isBone && names.includes(obj.name)) {
      obj.updateWorldMatrix(true, false);
      out[obj.name] = obj.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3));
    }
  });
  return out;
};