import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "splitroom",
  title: "Split the Room",
  vibe: "Backyard picket fence and yard-sale signs",
  paper: "mint",
  inks: ["teal","tangerine"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Rye\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","pin","scribble"],
  enter: "slide-tilt",
  sound: { bank: "wood", hostPitch: 1.04 },
  mox: { outfit: "bowtie" },
  motif: "curtain",
};

export default skin;
