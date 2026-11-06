import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "dumbinventions",
  title: "Dumb Inventions",
  vibe: "Patent blueprint and infomercial box",
  paper: "blueprint",
  inks: ["sun","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Oswald\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","tape","scribble"],
  enter: "unfold",
  sound: { bank: "comic", hostPitch: 1.06 },
  mox: { outfit: "tophat" },
  motif: "planet",
};

export default skin;
