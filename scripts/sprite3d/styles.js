// Style recipes for round 2 of the sprite3d prototype (#15): one PERSON TEMPLATE —
// a rigged Quaternius base body plus the one Universal Animation Library — with
// characters made by colouring the body per region. Pure data: the driver imports
// these and passes them into the page as JSON; the renderer turns each recipe into
// vertex colours.
//
// "Clothes" come from each vertex's dominant skinning bone (highest weight): boneMap
// is a list of [bone-name-prefix, region] pairs checked in order, and the region key
// indexes `regions`. The base body has no clothes mesh, so region colouring is what
// makes a jacket, trousers and boots.

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
      shirt: "#e8e6e0", // white shirt (collar / open-chest triangle at the throat)
      pants: "#40444b", // slightly darker charcoal trousers
      shoes: "#17181c", // black shoes
    },
    boneMap: [
      ["head", "skin"],
      ["neck", "shirt"], // white shirt collar at the throat
      ["spine_03", "shirt"], // upper chest reads as the shirt under the jacket
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
  },
};