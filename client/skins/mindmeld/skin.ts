import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "mindmeld",
  title: "Mind Meld",
  vibe: "Overlapping cellophane circles",
  paper: "butter",
  inks: ["bubblegum","sky"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Bricolage Grotesque\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["star","tape","scribble"],
  enter: "slide-tilt",
  sound: { bank: "chips", hostPitch: 1.06 },
  mox: { outfit: "party" },
  motif: "target",
};

export default skin;
