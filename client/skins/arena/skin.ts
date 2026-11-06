import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "arena",
  title: "Slingshot Arena",
  vibe: "Toy-box arena with rubber bands",
  paper: "cream",
  inks: ["sky","tangerine"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Lilita One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["star","tape","scribble"],
  enter: "drop",
  sound: { bank: "comic", hostPitch: 1.18 },
  mox: { outfit: "party" },
  motif: "top",
};

export default skin;
