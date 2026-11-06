import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "mostlikely",
  title: "Most Likely To",
  vibe: "School yearbook superlatives",
  paper: "cream",
  inks: ["cobalt","sun"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"DM Serif Display\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","tape","star"],
  enter: "slide-tilt",
  sound: { bank: "yearbook", hostPitch: 1.04 },
  mox: { outfit: "bowtie" },
  motif: "yearbook",
};

export default skin;
