import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "writevote",
  title: "Write & Vote",
  vibe: "Corkboard with sticky notes and marker",
  paper: "kraft",
  inks: ["bubblegum","teal"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Permanent Marker\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["pin","tape","scribble"],
  enter: "drop",
  sound: { bank: "marker", hostPitch: 1.02 },
  mox: { outfit: "bowtie" },
  motif: "note",
};

export default skin;
