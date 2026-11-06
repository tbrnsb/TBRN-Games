import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "poker",
  title: "Poker",
  vibe: "Kitchen-table card night with felt and chips",
  paper: "felt",
  inks: ["sun","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Alfa Slab One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["coffee-ring","tape","scribble"],
  enter: "stamp",
  sound: { bank: "chips", hostPitch: 0.86 },
  mox: { outfit: "sunglasses" },
  motif: "cards",
};

export default skin;
