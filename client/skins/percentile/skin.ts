import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "percentile",
  title: "Percentile",
  vibe: "Blue graph-paper survey sheet",
  paper: "blueprint",
  inks: ["sun","teal"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Oswald\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","pin","scribble"],
  enter: "drop",
  sound: { bank: "gauge", hostPitch: 1 },
  mox: { outfit: "bowtie" },
  motif: "planet",
};

export default skin;
