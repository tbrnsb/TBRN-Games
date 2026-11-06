import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "gravityrun",
  title: "Gravity Run",
  vibe: "Comic-book panels with halftone space",
  paper: "night",
  inks: ["sky","bubblegum"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Bangers\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["torn-edge","star","scribble"],
  enter: "stamp",
  sound: { bank: "comic", hostPitch: 1.24 },
  mox: { outfit: "sunglasses" },
  motif: "planet",
};

export default skin;
