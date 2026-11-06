import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "sloganshirts",
  title: "Slogan Shirts",
  vibe: "Screen-print shop with hang tags",
  paper: "kraft",
  inks: ["cobalt","tangerine"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Anton\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","pin","star"],
  enter: "stamp",
  sound: { bank: "marker", hostPitch: 1.04 },
  mox: { outfit: "chef" },
  motif: "note",
};

export default skin;
