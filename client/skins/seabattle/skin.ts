import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "seabattle",
  title: "Sea Battle",
  vibe: "Nautical chart on graph paper",
  paper: "mint",
  inks: ["cobalt","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Bungee\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","coffee-ring","tape"],
  enter: "unfold",
  sound: { bank: "sonar", hostPitch: 0.78 },
  mox: { outfit: "detective" },
  motif: "ship",
};

export default skin;
