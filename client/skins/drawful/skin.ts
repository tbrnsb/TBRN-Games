import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "drawful",
  title: "Drawful",
  vibe: "Kid's sketchbook with crayon textures",
  paper: "cream",
  inks: ["bubblegum","sky"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Permanent Marker\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","star","scribble"],
  enter: "unfold",
  sound: { bank: "marker", hostPitch: 1.1 },
  mox: { outfit: "party" },
  motif: "note",
};

export default skin;
