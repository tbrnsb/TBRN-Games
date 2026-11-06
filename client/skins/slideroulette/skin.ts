import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "slideroulette",
  title: "Slide Roulette",
  vibe: "Cheesy corporate slide deck",
  paper: "cream",
  inks: ["teal","tangerine"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Oswald\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","pin","scribble"],
  enter: "slide-tilt",
  sound: { bank: "buzzer", hostPitch: 1.14 },
  mox: { outfit: "bowtie" },
  motif: "tv",
};

export default skin;
