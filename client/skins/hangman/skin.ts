import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "hangman",
  title: "Hangman",
  vibe: "School notebook doodle page",
  paper: "cream",
  inks: ["cobalt","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Patrick Hand\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","scribble","fold"],
  enter: "unfold",
  sound: { bank: "pencil", hostPitch: 1 },
  mox: { outfit: "party" },
  motif: "gallows",
};

export default skin;
