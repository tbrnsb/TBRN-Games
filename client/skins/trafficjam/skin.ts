import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "trafficjam",
  title: "Traffic Jam",
  vibe: "City street map with sticky arrows",
  paper: "newsprint",
  inks: ["sun","cobalt"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Oswald\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","pin","scribble"],
  enter: "slide-tilt",
  sound: { bank: "horns", hostPitch: 0.96 },
  mox: { outfit: "detective" },
  motif: "car",
};

export default skin;
