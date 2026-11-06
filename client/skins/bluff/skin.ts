import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "bluff",
  title: "Bluff",
  vibe: "Carnival barker banner and stage curtains",
  paper: "cream",
  inks: ["tomato","sun"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Rye\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","star","scribble"],
  enter: "curtain",
  sound: { bank: "brass", hostPitch: 1.12 },
  mox: { outfit: "bowtie" },
  motif: "curtain",
};

export default skin;
