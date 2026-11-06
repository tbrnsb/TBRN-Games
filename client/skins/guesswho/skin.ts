import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "guesswho",
  title: "Guess Who",
  vibe: "Detective case file with polaroid mugshots",
  paper: "kraft",
  inks: ["cobalt","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Special Elite\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","tape","coffee-ring"],
  enter: "slide-tilt",
  sound: { bank: "typewriter", hostPitch: 0.9 },
  mox: { outfit: "detective" },
  motif: "magnifier",
};

export default skin;
