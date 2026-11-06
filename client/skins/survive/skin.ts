import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "survive",
  title: "Survive the Internet",
  vibe: "Tabloid newspaper with a red correction pen",
  paper: "newsprint",
  inks: ["tomato","cobalt"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Special Elite\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","coffee-ring","paperclip"],
  enter: "stamp",
  sound: { bank: "typewriter", hostPitch: 1.08 },
  mox: { outfit: "detective" },
  motif: "note",
};

export default skin;
