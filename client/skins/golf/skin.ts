import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "golf",
  title: "Golf",
  vibe: "Putt-putt course sign and pencil scorecard",
  paper: "mint",
  inks: ["grass","sun"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Lilita One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","fold","star"],
  enter: "drop",
  sound: { bank: "plop", hostPitch: 1.06 },
  mox: { outfit: "bowtie" },
  motif: "flag",
};

export default skin;
