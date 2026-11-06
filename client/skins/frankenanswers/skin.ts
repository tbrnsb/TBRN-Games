import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "frankenanswers",
  title: "Frankenanswers",
  vibe: "Magnetic word tiles on a fridge door",
  paper: "cream",
  inks: ["grape","tangerine"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"DM Serif Display\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","star","scribble"],
  enter: "drop",
  sound: { bank: "chips", hostPitch: 1.02 },
  mox: { outfit: "chef" },
  motif: "note",
};

export default skin;
