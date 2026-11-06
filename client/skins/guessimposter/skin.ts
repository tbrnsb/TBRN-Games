import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "guessimposter",
  title: "Guess the Imposter",
  vibe: "Detective case file with polaroids",
  paper: "kraft",
  inks: ["cobalt","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Special Elite\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","tape","coffee-ring"],
  enter: "drop",
  sound: { bank: "typewriter", hostPitch: 0.88 },
  mox: { outfit: "detective" },
  motif: "magnifier",
};

export default skin;
