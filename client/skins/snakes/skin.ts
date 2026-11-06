import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "snakes",
  title: "Snakes",
  vibe: "Board-game box lid and wooden board",
  paper: "butter",
  inks: ["grass","grape"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Modak\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","star","scribble"],
  enter: "unfold",
  sound: { bank: "dice", hostPitch: 1.08 },
  mox: { outfit: "party" },
  motif: "snake",
};

export default skin;
