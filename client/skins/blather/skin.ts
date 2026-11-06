import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "blather",
  title: "Blather Round",
  vibe: "Dog-eared dictionary page",
  paper: "cream",
  inks: ["cobalt","sun"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"DM Serif Display\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","coffee-ring","scribble"],
  enter: "unfold",
  sound: { bank: "pencil", hostPitch: 1 },
  mox: { outfit: "tophat" },
  motif: "note",
};

export default skin;
