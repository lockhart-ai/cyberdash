// Sprite3D prototype renderer module (#15). Loaded by page.html, driven via window.__sprite3d.
// Renders one rigged GLB animation pose to a 64x64 isometric pixel-art frame:
// fixed orthographic camera at the game's 2:1 isometric elevation, toon shading,
// binary alpha, <=24 colours, 1px near-black outer outline, interior ink between colour
// zones, and a drawn-on face (round 3, #15).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const SIZE = 64; // render size in pixels, matches the courier frames
const FIGURE_H_PX = 44; // target figure height in pixels
const FEET_ROW = 55; // courier baseline: lowest feet pixel row (0 = top)
const OUTLINE = [0x0b, 0x08, 0x08]; // near-black outline, matches the courier
const MAX_COLORS = 24;

// Round 3 (#15) chibi proportions: the Superhero base's Head bone is a leaf joint at
// the jaw/skull base, so scaling it stretches the head mesh outward from that pivot in
// every direction — a bigger skull, a bit more jaw. Measured against the courier
// reference (public/assets/player/south.png): opaque silhouette is 46px tall (rows
// 10-55), and the head (crown to the neck taper at the shoulder flare) spans rows
// 10-23, 14px ≈ 30% of the figure — well above the Superhero body's ~12% (Head-bone-
// to-crown is ~0.214 of its 1.823-unit height, ~12% once legs are included). Because
// the figure is always recalibrated to FIGURE_H_PX afterward (see calibrate below),
// growing the head also shrinks the rest of the figure in the final pixels, which
// dilutes a given HEAD_SCALE's effect on the final head fraction — shortening the legs
// (LEG_SCALE below) helps claw some of that back. Measured on the rendered output,
// HEAD_SCALE 1.8 + LEG_SCALE 0.88 lands the head at ~22% of the figure: a close-but-
// not-exact match to the courier, and about the most this lever alone can close the
// gap without the head starting to look balloon-like relative to the unwidened
// shoulders — stated honestly in the round 3 report rather than chased further.
const HEAD_SCALE = 1.8;
// Uniform (not axis-picked) scale on thigh+calf: the rig's bind orientation isn't
// known to have a "down the bone" local axis we can rely on, so scaling all three axes
// shortens the leg (via the parent-scale-propagates-to-children chain) with only a
// minor, acceptable thinning as a side effect — simpler and safer than guessing an axis.
const LEG_SCALE = 0.88;

// Round 3 face post-pass: eye/glasses placement in world units above the Head bone
// (which sits at the jaw, not moved by scaling it — see setPose) and forward of it
// (toward the nose), tuned against the courier's glasses row (south.png row 18 of 46,
// roughly the upper third of the head) by rendering and looking. The jaw-to-crown span
// grows by HEAD_SCALE (it's mesh skinned to the Head bone, scaled from the jaw pivot —
// see HEAD_SCALE above), so this offset must scale with it too, or it stays pinned near
// the jaw while the head grows past it (as a first pass did: eyes landed at ~3% up the
// face instead of ~45%). Pixel offsets, by contrast, are applied in screen space once
// the head point is projected, so they stay correct regardless of world scale.
const EYE_HEIGHT = 0.1 * HEAD_SCALE; // world units above the Head bone joint
const EYE_FORWARD_PX = 2; // px toward the face's forward direction, from the eye-height point
const EYE_SIDE_PX = 2; // px either side of centre, for a frontal (two-eye) face
const CYAN = [80, 195, 230]; // courier's glasses lens colour (sampled from south.png)
const MOUTH_DROP_PX = 2; // px further forward+down than the eyes, for the punk's mouth
// A near-black eye (no glasses) all but disappears against dark hair (checked on the
// corporate recipe, dark-brown hair over near-black eyes) — this 1px off-white catchlight
// above each eye reads against any hair colour, the way a glasses lens already does.
const EYE_HIGHLIGHT = [235, 232, 225];

// Orthographic view direction: horizontal (1,1)/sqrt(2) (from target toward camera),
// elevation atan(0.5) => the game's 2:1 isometric ground. (Round 1 used (1,1,0.5),
// which normalizes to elevation ~42°, not atan(0.5) ~26.6° — horizontal limbs
// projected at ~53° and figures read as tilted. (1, 0.707, 1) is the true 2:1 angle.)
const VIEW_DIR = new THREE.Vector3(1, Math.SQRT1_2, 1).normalize();

let renderer, scene, camera, pivot, mixer, clipsByName;
// Fixed framing per model (computed once from the loaded model's bounds) so all
// frames of a character share the same camera and don't jitter between poses.
let framing = null;
// Round 3: bones scaled every frame for chibi proportions (set in load(), applied in
// setPose()), and the current recipe's face spec (for the post-pass).
let chibiBones = null;
let currentRecipe = null;

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
// the body's — matched by name, in the hair skeleton's order. Every hair vertex is
// 100% weighted to the Head bone (checked with the dumpVerts debug hook) and reaches
// at most 0.223 world units from it (dumpHairDistances, on Hair_Long, the longest
// style used here) — so scaling Head for the chibi head (HEAD_SCALE, in setPose)
// grows the whole hairstyle by the same factor and keeps it exactly as far outside the
// skull as it started; no separate correction needed.
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
  if (!bodySkin)
    throw new Error("body model has no skinned mesh to bind hair to");
  const bodyBones = new Map(bodySkin.skeleton.bones.map((b) => [b.name, b]));
  const bones = hairMesh.skeleton.bones.map((b) => {
    const match = bodyBones.get(b.name);
    if (!match)
      throw new Error(
        `hair bone "${b.name}" has no match on the body skeleton`,
      );
    return match;
  });
  hairMesh.frustumCulled = false; // skinned bounds don't track the deformed shape
  hairMesh.bind(
    new THREE.Skeleton(bones, hairMesh.skeleton.boneInverses),
    hairMesh.bindMatrix,
  );
  hairMesh.userData.isHair = true;
  model.add(hairMesh);
  return hairMesh;
}

// Region for one vertex: recipe.frontWedge entries (checked first) split a bone region
// by facing — e.g. the corporate's spine/neck read as the white shirt only where the
// surface normal faces forward (the chest), and as the jacket everywhere else, so the
// shirt doesn't bleed around to the back. Falls through to the plain boneMap otherwise.
// Matching is case-insensitive: the rig's bone names mix cases ("Head" vs "neck_01").
function regionFor(boneName, normalZ, recipe) {
  const lower = boneName.toLowerCase();
  if (recipe.frontWedge) {
    for (const rule of recipe.frontWedge) {
      if (rule.prefixes.some((p) => lower.startsWith(p.toLowerCase()))) {
        return normalZ > (rule.threshold ?? 0.3) ? rule.front : rule.back;
      }
    }
  }
  for (const [prefix, region] of recipe.boneMap) {
    if (lower.startsWith(prefix.toLowerCase())) return region;
  }
  return "skin";
}

// Flat, per-triangle region colouring (round 3, #15): round 2 coloured each vertex by
// its dominant skinning bone, then let the GPU interpolate across every triangle — at
// a region boundary (e.g. neck/collar) that smears two colours into a ragged gradient
// instead of a clean edge. Here every vertex of a triangle is forced to the SAME
// colour (the majority region among its 3 corners), so a triangle is one flat zone and
// adjacent zones meet at a hard edge the post-pass can then ink. Needs a non-indexed
// geometry first: an indexed vertex is shared by several triangles, so it can't hold a
// different colour for each.
function paintZonesFlat(obj, recipe) {
  if (obj.geometry.index) obj.geometry = obj.geometry.toNonIndexed();
  const geo = obj.geometry;
  const bones = obj.skeleton.bones;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const count = pos.count;
  const regions = new Array(count);
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
    const boneName = bones[best] ? bones[best].name : "";
    regions[i] = regionFor(boneName, nrm.getZ(i), recipe);
  }
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let t = 0; t < count; t += 3) {
    // Majority vote among the triangle's 3 corners; all-different ties keep corner 0.
    const r0 = regions[t];
    const r1 = regions[t + 1];
    const r2 = regions[t + 2];
    const region = r0 === r1 || r0 === r2 ? r0 : r1 === r2 ? r1 : r0;
    c.set(recipe.regions[region] ?? recipe.regions.skin);
    for (let k = 0; k < 3; k++) {
      colors[(t + k) * 3] = c.r;
      colors[(t + k) * 3 + 1] = c.g;
      colors[(t + k) * 3 + 2] = c.b;
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// Turn a style recipe (styles.js) into flat per-zone colours: every triangle of the
// skinned body mesh takes one colour (its majority region — see paintZonesFlat); hair
// and eyebrows take flat recipe colours. Also builds an unlit "ID" material per mesh,
// used by the post-pass to find true zone edges (see renderIdPass in renderFrame)
// without the toon shading bands being mistaken for zone boundaries.
function styleModel(model, recipe) {
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.isHair) {
      obj.material = toonMaterial(obj.material);
      obj.material.color.set(recipe.regions.hair);
      obj.material.map = null;
      obj.userData.idMaterial = new THREE.MeshBasicMaterial({
        color: obj.material.color.clone(),
      });
      return;
    }
    if (obj.name.startsWith("Eyebrows")) {
      obj.material = toonMaterial(obj.material);
      obj.material.color.set(recipe.eyebrowColor);
      obj.material.map = null;
      obj.userData.idMaterial = new THREE.MeshBasicMaterial({
        color: obj.material.color.clone(),
      });
      return;
    }
    if (obj.name === "Eyes") {
      // Keep the eye texture off-screen; the face post-pass draws eyes directly. In the
      // ID pass, treat eyes as skin so they don't register as a stray zone edge.
      obj.userData.idMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(recipe.regions.skin),
      });
      return;
    }
    if (!(obj.isSkinnedMesh && obj.geometry.attributes.skinIndex)) return;
    paintZonesFlat(obj, recipe);
    const mat = toonMaterial(obj.material);
    mat.vertexColors = true;
    mat.flatShading = true; // one shading normal per triangle, to match the flat zone colours
    mat.map = null; // the skin texture would muddy the recipe colours
    obj.material = mat;
    obj.userData.idMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
    });
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
        throw new Error(
          `multi-material mesh ${obj.name}: not supported in this prototype`,
        );
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

  // Round 3 (#15): bones scaled every frame for chibi proportions (see setPose) and
  // the recipe used by the face post-pass (see renderFrame). Same rig for every body
  // (male and female share bone names), so these must exist — fail loudly if not.
  chibiBones = { head: null, legs: [] };
  model.traverse((obj) => {
    if (!obj.isBone) return;
    if (obj.name === "Head") chibiBones.head = obj;
    if (
      obj.name === "thigh_l" ||
      obj.name === "thigh_r" ||
      obj.name === "calf_l" ||
      obj.name === "calf_r"
    ) {
      chibiBones.legs.push(obj);
    }
  });
  if (!chibiBones.head || chibiBones.legs.length !== 4) {
    throw new Error(
      `chibi bone scaling needs Head + thigh/calf l/r; found head=${!!chibiBones.head} legs=${chibiBones.legs.length}`,
    );
  }
  currentRecipe = opts.recipe ?? null;

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
    durations: Object.fromEntries(
      [...clipsByName].map(([name, clip]) => [name, clip.duration]),
    ),
    animSource,
    height,
    materialsReplaced: replaced,
  };
}

function setPose(clipName, t, yawDeg) {
  const clip = clipsByName.get(clipName);
  if (!clip)
    throw new Error(
      `no clip named "${clipName}" (have: ${[...clipsByName.keys()].join(", ")})`,
    );
  const action = mixer.clipAction(clip);
  action.play();
  action.paused = true;
  action.time = Math.min(Math.max(t, 0), clip.duration);
  mixer.update(0);
  // Round 3 (#15) chibi proportions: applied after the mixer update on every frame, so
  // the animation (which doesn't touch bone scale) never overwrites it.
  chibiBones.head.scale.setScalar(HEAD_SCALE);
  for (const bone of chibiBones.legs) bone.scale.setScalar(LEG_SCALE);
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
    const box = boxes[best]
      .slice()
      .sort((a, b) => a[bestChannel] - b[bestChannel]);
    const mid = Math.floor(box.length / 2);
    boxes = boxes
      .filter((_, i) => i !== best)
      .concat([box.slice(0, mid), box.slice(mid)]);
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
    const pixels = [...colors.keys()].map((k) => [
      (k >> 16) & 255,
      (k >> 8) & 255,
      k & 255,
    ]);
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
    let minx = SIZE,
      maxx = -1,
      miny = SIZE,
      maxy = -1;
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
    if (
      h === TARGET_H &&
      maxy === TARGET_BOTTOM &&
      Math.round((minx + maxx + 1) / 2) === 32
    )
      break;

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
  const target = new THREE.Vector3(
    framing.targetX,
    framing.centerY,
    framing.targetZ,
  );
  camera.position.copy(VIEW_DIR).multiplyScalar(100).add(target);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

// --- post-pass: interior ink between colour zones (round 3, #15) ----------------
//
// The toon shader's 3-step gradient gives each flat zone 2-3 tones of its own colour
// (see paintZonesFlat) — so finding zone edges by comparing the *shaded* pixels would
// also catch shading-step edges inside a single zone, which isn't what we want (the
// courier's own ink is at cloth seams, not at every highlight/shadow boundary). Instead
// render a second, unlit pass with each mesh's flat colours and no lighting (see
// idMaterial in styleModel): there every zone is a single flat colour, so any edge
// found there is a true zone boundary, which gets inked onto the real frame.
const idWork = document.createElement("canvas");
idWork.width = SIZE;
idWork.height = SIZE;
const idCtx = idWork.getContext("2d", { willReadFrequently: true });

function renderIdPass() {
  const swapped = [];
  pivot.traverse((obj) => {
    if (obj.isMesh && obj.userData.idMaterial) {
      swapped.push([obj, obj.material]);
      obj.material = obj.userData.idMaterial;
    }
  });
  renderer.render(scene, camera);
  idCtx.clearRect(0, 0, SIZE, SIZE);
  idCtx.drawImage(renderer.domElement, 0, 0);
  for (const [obj, mat] of swapped) obj.material = mat;
  return idCtx.getImageData(0, 0, SIZE, SIZE).data;
}

// Inks interior zone edges onto `work` (the canvas postProcess() already wrote the
// quantized, outer-outlined frame to). A small per-channel tolerance absorbs any
// float->8-bit rounding noise between equal ID colours.
const ZONE_EDGE_TOLERANCE = 12;

function paintZoneInk() {
  const id = renderIdPass();
  const img = workCtx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const opaque = (x, y) => d[(y * SIZE + x) * 4 + 3] > 0;
  const differs = (ia, ib) => {
    return (
      Math.abs(id[ia] - id[ib]) +
        Math.abs(id[ia + 1] - id[ib + 1]) +
        Math.abs(id[ia + 2] - id[ib + 2]) >
      ZONE_EDGE_TOLERANCE
    );
  };
  const edge = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!opaque(x, y)) continue;
      const i = (y * SIZE + x) * 4;
      if (x < SIZE - 1 && opaque(x + 1, y) && differs(i, i + 4))
        edge.push(y * SIZE + x);
      else if (y < SIZE - 1 && opaque(x, y + 1) && differs(i, i + SIZE * 4))
        edge.push(y * SIZE + x);
    }
  }
  for (const i of edge) {
    const o = i * 4;
    d[o] = OUTLINE[0];
    d[o + 1] = OUTLINE[1];
    d[o + 2] = OUTLINE[2];
    d[o + 3] = 255;
  }
  workCtx.putImageData(img, 0, 0);
}

// --- post-pass: a drawn-on face (round 3, #15) -----------------------------------
//
// Projects the Head bone's current world position through the camera to find where
// the face is on screen, and where it's facing (toward a point one step further
// forward, in the same world-forward direction used for the figure's own yaw). Visible
// directions fall out of that facing direction's alignment with the camera, rather
// than a hardcoded per-direction table: facingDot is the figure-forward•camera-direction
// dot product, which is ~0.89 facing the camera dead-on (south), ~0.63 for the
// three-quarter views (south-east, south-west), 0 for a pure profile (east, west), and
// negative facing away (the north three) — matching exactly the fix's visible-direction
// list without naming directions at all.
function hexToRgb(hex) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paintFace(yawDeg) {
  if (!currentRecipe?.face) return;
  const yawRad = (yawDeg * Math.PI) / 180;
  const forwardWorld = new THREE.Vector3(Math.sin(yawRad), 0, Math.cos(yawRad));
  const facingDot = forwardWorld.dot(VIEW_DIR);
  if (facingDot < -0.01) return; // the north three: back of the head, no face to paint

  chibiBones.head.updateWorldMatrix(true, false);
  const eyePoint = chibiBones.head
    .getWorldPosition(new THREE.Vector3())
    .add(new THREE.Vector3(0, EYE_HEIGHT, 0));
  const nosePoint = eyePoint.clone().addScaledVector(forwardWorld, 0.08);
  const toScreen = (p) => {
    const ndc = p.clone().project(camera);
    return {
      x: (ndc.x * 0.5 + 0.5) * SIZE,
      y: (1 - (ndc.y * 0.5 + 0.5)) * SIZE,
    };
  };
  const centerS = toScreen(eyePoint);
  const noseS = toScreen(nosePoint);
  let fx = noseS.x - centerS.x;
  let fy = noseS.y - centerS.y;
  const flen = Math.hypot(fx, fy) || 1;
  fx /= flen;
  fy /= flen;
  const px = -fy;
  const py = fx; // screen-space perpendicular, for the second eye

  const img = workCtx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const setPx = (x, y, rgb) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
    const o = (y * SIZE + x) * 4;
    if (d[o + 3] === 0) return; // only paint onto the figure, never the background
    d[o] = rgb[0];
    d[o + 1] = rgb[1];
    d[o + 2] = rgb[2];
    d[o + 3] = 255;
  };

  const frontal = facingDot > 0.3; // south, south-east, south-west: both eyes visible
  const eyeColor = hexToRgb(currentRecipe.face.eyeColor);
  const ex0 = centerS.x + fx * EYE_FORWARD_PX;
  const ey0 = centerS.y + fy * EYE_FORWARD_PX;

  if (frontal) {
    for (const s of [-1, 1]) {
      const ex = ex0 + px * EYE_SIDE_PX * s;
      const ey = ey0 + py * EYE_SIDE_PX * s;
      if (currentRecipe.face.glasses) {
        setPx(ex - 1, ey, CYAN);
        setPx(ex, ey, CYAN);
        setPx(ex + 1, ey, CYAN);
      } else {
        setPx(ex, ey, eyeColor);
        setPx(ex, ey + 1, eyeColor);
        setPx(ex, ey - 1, EYE_HIGHLIGHT);
      }
    }
    if (currentRecipe.face.glasses) setPx(ex0, ey0, CYAN); // bridge between the lenses
    if (currentRecipe.face.mouth) {
      setPx(
        centerS.x + fx * MOUTH_DROP_PX,
        centerS.y + fy * MOUTH_DROP_PX + 1,
        OUTLINE,
      );
    }
  } else {
    // A profile (east/west): only the near eye is visible.
    if (currentRecipe.face.glasses) {
      setPx(ex0 - 1, ey0, CYAN);
      setPx(ex0, ey0, CYAN);
    } else {
      setPx(ex0, ey0, eyeColor);
      setPx(ex0, ey0 - 1, EYE_HIGHLIGHT);
    }
  }
  workCtx.putImageData(img, 0, 0);
}

function renderFrame(clipName, t, yawDeg) {
  setPose(clipName, t, yawDeg);
  renderer.render(scene, camera);
  postProcess();
  paintZoneInk();
  paintFace(yawDeg);
  // Copy to a fresh canvas: `work` is reused between frames.
  const out = document.createElement("canvas");
  out.width = SIZE;
  out.height = SIZE;
  out.getContext("2d").drawImage(work, 0, 0);
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
    ctx.drawImage(
      img,
      cell.dx * scale,
      cell.dy * scale,
      cell.w * scale,
      cell.h * scale,
    );
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
      out[obj.name] = obj
        .getWorldPosition(new THREE.Vector3())
        .toArray()
        .map((v) => +v.toFixed(3));
    }
  });
  return out;
};

// Debug hook: every bone's name, parent name and rest-pose world Y (exploration only).
window.__sprite3d.dumpSkeleton = () => {
  const out = [];
  scene.traverse((obj) => {
    if (obj.isBone) {
      obj.updateWorldMatrix(true, false);
      const p = obj.getWorldPosition(new THREE.Vector3());
      out.push({
        name: obj.name,
        parent: obj.parent?.name ?? null,
        y: +p.y.toFixed(4),
      });
    }
  });
  return out;
};

// Debug hook (exploration only): per-vertex dominant bone, local position and normal
// for the main skinned mesh, filtered to a set of bone-name prefixes.
window.__sprite3d.dumpVerts = (prefixes) => {
  let mesh = null;
  pivot.traverse((obj) => {
    if (
      obj.isSkinnedMesh &&
      !obj.userData.isHair &&
      obj.name !== "Eyebrows" &&
      obj.name !== "Eyes"
    ) {
      if (
        !mesh ||
        obj.geometry.attributes.position.count >
          mesh.geometry.attributes.position.count
      )
        mesh = obj;
    }
  });
  if (!mesh) return [];
  const bones = mesh.skeleton.bones;
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const out = [];
  for (let i = 0; i < pos.count; i++) {
    let best = 0;
    let bestW = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bestW) {
        bestW = w;
        best = si.getComponent(i, k);
      }
    }
    const boneName = bones[best] ? bones[best].name : "";
    if (!prefixes.some((p) => boneName.startsWith(p))) continue;
    out.push({
      bone: boneName,
      x: +pos.getX(i).toFixed(4),
      y: +pos.getY(i).toFixed(4),
      z: +pos.getZ(i).toFixed(4),
      nx: +nrm.getX(i).toFixed(3),
      ny: +nrm.getY(i).toFixed(3),
      nz: +nrm.getZ(i).toFixed(3),
    });
  }
  return out;
};
