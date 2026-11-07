import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "racing",
  title: "Racing",
  vibe: "Vintage Grand Prix poster",
  paper: "cream",
  inks: ["cobalt","teal"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Anton\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["torn-edge","scribble","star"],
  enter: "slide-tilt",
  sound: { bank: "engine", hostPitch: 1 },
  mox: { outfit: "tophat" },
  motif: "checker",
};

export default skin;
