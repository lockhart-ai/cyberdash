// Style recipes for the sprite3d prototype (#15): one PERSON TEMPLATE — a rigged
// Quaternius base body plus the one Universal Animation Library — with characters made
// by colouring the body per region. Pure data: the driver imports these and passes
// them into the page as JSON; the renderer turns each recipe into vertex colours
// (paintZonesFlat in renderer.js) and a drawn-on face (paintFace).
//
// "Clothes" come from each vertex's dominant skinning bone (highest weight): boneMap
// is a list of [bone-name-prefix, region] pairs checked in order, and the region key
// indexes `regions`. The base body has no clothes mesh, so region colouring is what
// makes a jacket, trousers and boots. Matching is case-insensitive (see regionFor).
//
// frontWedge (round 3, #15): for bones listed there, the vertex's surface normal
// decides the region instead of boneMap — front-facing (normal.z > threshold) gets
// `front`, everything else gets `back`. Used so a shirt reads as a front chest/collar
// wedge and doesn't wrap around to colour the jacket's back.
//
// face (round 3, #15): eyeColor is a plain pixel-art eye; glasses draws the courier's
// cyan lens band instead; mouth adds a single dark pixel below the eyes on frontal
// views only. See paintFace in renderer.js.

export const RECIPES = {
  punk: {
    label: "Punk",
    bodyUrl: "/models2/base/Superhero_Male_FullBody.gltf",
    hairUrl: "/models2/hair/Hair_Buzzed.gltf",
    eyebrowColor: "#8a0f74", // magenta brows to match the dyed hair
    regions: {
      skin: "#e8b48f", // light skin tone
      hair: "#c918a8", // hot magenta
      top: "#5a1e28", // oxblood jacket
      pants: "#2b2f66", // indigo
      shoes: "#15151a", // near-black boots
      accent: "#35d0c6", // cyan forearm accent
    },
    boneMap: [
      ["head", "skin"],
      ["neck", "skin"],
      ["spine", "top"],
      ["clavicle", "top"],
      ["upperarm", "top"],
      ["lowerarm", "accent"], // cyan forearms
      ["hand", "skin"],
      ["index", "skin"],
      ["middle", "skin"],
      ["pinky", "skin"],
      ["ring", "skin"],
      ["thumb", "skin"],
      ["pelvis", "pants"],
      ["thigh", "pants"],
      ["calf", "pants"],
      ["foot", "shoes"],
      ["ball", "shoes"],
      ["root", "pants"],
    ],
    face: { eyeColor: "#1a1510", glasses: false, mouth: true },
  },
  corporate: {
    label: "Corporate",
    bodyUrl: "/models2/base/Superhero_Female_FullBody.gltf",
    hairUrl: "/models2/hair/Hair_Long.gltf",
    eyebrowColor: "#3a2418",
    regions: {
      skin: "#d29a6f", // medium skin tone
      hair: "#3a2418", // dark brown
      top: "#52565e", // charcoal suit jacket
      shirt: "#e8e6e0", // white shirt (front chest/collar wedge, see frontWedge below)
      pants: "#40444b", // slightly darker charcoal trousers
      shoes: "#17181c", // black shoes
    },
    boneMap: [
      ["head", "skin"],
      ["neck", "top"], // the back of the collar is jacket; frontWedge covers the front
      ["spine", "top"],
      ["clavicle", "top"],
      ["upperarm", "top"],
      ["lowerarm", "top"], // jacket sleeves
      ["hand", "skin"],
      ["index", "skin"],
      ["middle", "skin"],
      ["pinky", "skin"],
      ["ring", "skin"],
      ["thumb", "skin"],
      ["pelvis", "pants"],
      ["thigh", "pants"],
      ["calf", "pants"],
      ["foot", "shoes"],
      ["ball", "shoes"],
      ["root", "pants"],
    ],
    frontWedge: [
      {
        prefixes: ["neck", "spine_03"],
        front: "shirt",
        back: "top",
        threshold: 0.3,
      },
    ],
    face: { eyeColor: "#1a1510", glasses: false, mouth: false },
  },
  // Round 3 (#15): a third recipe built to echo the hand-pixelled courier (same cut —
  // dark suit, white shirt front, glasses) so its sheet row sits right next to the
  // courier's for a direct side-by-side comparison.
  operative: {
    label: "Operative",
    bodyUrl: "/models2/base/Superhero_Male_FullBody.gltf",
    hairUrl: "/models2/hair/Hair_SimpleParted.gltf",
    eyebrowColor: "#15120f",
    regions: {
      skin: "#caa07a",
      hair: "#15120f", // black
      top: "#1c1c22", // black suit
      shirt: "#e8e6e0", // white shirt front
      pants: "#1c1c22", // black trousers
      shoes: "#0c0c0f", // black shoes
    },
    boneMap: [
      ["head", "skin"],
      ["neck", "top"],
      ["spine", "top"],
      ["clavicle", "top"],
      ["upperarm", "top"],
      ["lowerarm", "top"],
      ["hand", "skin"],
      ["index", "skin"],
      ["middle", "skin"],
      ["pinky", "skin"],
      ["ring", "skin"],
      ["thumb", "skin"],
      ["pelvis", "pants"],
      ["thigh", "pants"],
      ["calf", "pants"],
      ["foot", "shoes"],
      ["ball", "shoes"],
      ["root", "pants"],
    ],
    frontWedge: [
      {
        prefixes: ["neck", "spine_03"],
        front: "shirt",
        back: "top",
        threshold: 0.3,
      },
    ],
    face: { eyeColor: "#1a1510", glasses: true, mouth: false },
  },
  // Round 4 (#16), approach A: recipe hand-written after looking at the
  // generated concept (skin-output/round1/raw/openai__gpt-image-2/concept.png)
  // - a street punk with a spiked neon-green mohawk, studded black leather
  // jacket covered in patches, ripped dark jeans, chunky black boots, and a
  // metallic cyber-arm (right forearm + hand). Colours sampled from the
  // concept image. Honest gap: none of the library hairstyles is an actual
  // mohawk (shaved sides, central spike) - Hair_Buzzed is the closest
  // silhouette available, recoloured neon green; it reads as "short green
  // hair", not a mohawk silhouette.
  streetpunk: {
    label: "Street punk",
    bodyUrl: "/models2/base/Superhero_Male_FullBody.gltf",
    hairUrl: "/models2/hair/Hair_Buzzed.gltf",
    eyebrowColor: "#1a1510",
    regions: {
      skin: "#ca8466", // tan skin, sampled from the concept's face
      hair: "#7fd82e", // neon-green mohawk
      top: "#141414", // black studded leather jacket
      pants: "#3a3f4a", // dark slate ripped jeans
      shoes: "#0e0e0f", // black boots
      accent: "#b8babc", // the cyber-arm's brushed metal
    },
    // Cyber-arm: right forearm + hand coloured metallic, checked before the
    // generic rules below so only that side gets it ("lowerarm_r"/"hand_r"
    // are the bones' literal full names, so a prefix match is exact here).
    // Honest gap: the finger bones are named "index_01_r" etc - a prefix
    // match can't select "ends with _r" on those, only "starts with", so
    // there's no way to single out the right hand's fingers without editing
    // regionFor() itself (out of scope for a recipe-only change) - all
    // fingers on both hands stay skin-toned. Barely visible at 64px.
    boneMap: [
      ["lowerarm_r", "accent"],
      ["hand_r", "accent"],
      ["head", "skin"],
      ["neck", "skin"],
      ["spine", "top"],
      ["clavicle", "top"],
      ["upperarm", "top"],
      ["lowerarm", "top"], // left sleeve stays jacket (long-sleeved on the non-cyber arm)
      ["hand", "skin"], // left hand, bare
      ["index", "skin"],
      ["middle", "skin"],
      ["pinky", "skin"],
      ["ring", "skin"],
      ["thumb", "skin"],
      ["pelvis", "pants"],
      ["thigh", "pants"],
      ["calf", "pants"],
      ["foot", "shoes"],
      ["ball", "shoes"],
      ["root", "pants"],
    ],
    // glasses:true draws the renderer's fixed cyan lens band (not the
    // concept's red-lensed sunglasses - the face post-pass has no per-recipe
    // lens colour) - kept anyway since a HUD-style band still reads as
    // "augmented/cyber" at 64px, closer to the brief's cyber theme than a
    // plain eye would.
    face: { eyeColor: "#1a1510", glasses: true, mouth: true },
  },
};

// Round 4 (#16), approach C: a neutral grey mannequin recipe - same body +
// boneMap shape as the recipes above (so the silhouette and proportions
// match exactly what the image models are asked to repaint), but every zone
// is a flat grey and there's no face paint (face omitted, so paintFace's
// `if (!currentRecipe?.face) return;` guard skips it - see renderer.js).
// Exported separately from RECIPES so render.mjs's normal "one row per
// RECIPES entry" review sheets aren't disturbed by an extra grey row;
// reskin.mjs imports it directly.
export const MANNEQUIN_RECIPE = {
  label: "Mannequin",
  bodyUrl: "/models2/base/Superhero_Male_FullBody.gltf",
  hairUrl: "/models2/hair/Hair_Buzzed.gltf",
  eyebrowColor: "#9a9a9a",
  regions: {
    skin: "#b4b4b4", // light grey body
    hair: "#6e6e6e", // darker grey hair
    top: "#b4b4b4",
    pants: "#b4b4b4",
    shoes: "#b4b4b4",
    accent: "#b4b4b4",
  },
  boneMap: [
    ["head", "skin"],
    ["neck", "skin"],
    ["spine", "top"],
    ["clavicle", "top"],
    ["upperarm", "top"],
    ["lowerarm", "top"],
    ["hand", "skin"],
    ["index", "skin"],
    ["middle", "skin"],
    ["pinky", "skin"],
    ["ring", "skin"],
    ["thumb", "skin"],
    ["pelvis", "pants"],
    ["thigh", "pants"],
    ["calf", "pants"],
    ["foot", "shoes"],
    ["ball", "shoes"],
    ["root", "pants"],
  ],
};
