import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "fakin",
  title: "Fakin' It",
  vibe: "Spy dossier with rubber stamps",
  paper: "newsprint",
  inks: ["tomato","cobalt"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Special Elite\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","tape","scribble"],
  enter: "stamp",
  sound: { bank: "typewriter", hostPitch: 0.92 },
  mox: { outfit: "sunglasses" },
  motif: "magnifier",
};

export default skin;
