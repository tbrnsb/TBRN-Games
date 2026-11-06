import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "archery",
  title: "Archery",
  vibe: "Medieval tournament woodcut poster",
  paper: "butter",
  inks: ["tomato","teal"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Pirata One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","coffee-ring","scribble"],
  enter: "slide-tilt",
  sound: { bank: "wood", hostPitch: 0.82 },
  mox: { outfit: "tophat" },
  motif: "target",
};

export default skin;
