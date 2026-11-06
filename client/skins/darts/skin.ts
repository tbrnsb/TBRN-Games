import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "darts",
  title: "Darts",
  vibe: "Pub chalkboard with beer-mat scoreboard",
  paper: "chalkboard",
  inks: ["sun","bubblegum"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Caveat Brush\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["coffee-ring","torn-edge","scribble"],
  enter: "stamp",
  sound: { bank: "chalk", hostPitch: 0.94 },
  mox: { outfit: "sunglasses" },
  motif: "dartboard",
};

export default skin;
