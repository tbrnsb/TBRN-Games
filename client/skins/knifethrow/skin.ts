import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "knifethrow",
  title: "Knife Throw",
  vibe: "Circus poster with a spinning wheel",
  paper: "butter",
  inks: ["tomato","cobalt"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Bowlby One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["star","torn-edge","scribble"],
  enter: "drop",
  sound: { bank: "circus", hostPitch: 1.18 },
  mox: { outfit: "tophat" },
  motif: "knife",
};

export default skin;
