import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "slotcar",
  title: "Slot Car",
  vibe: "1960s toy-catalog spread",
  paper: "cream",
  inks: ["tangerine","sky"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Shrikhand\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["star","fold","torn-edge"],
  enter: "slide-tilt",
  sound: { bank: "slot", hostPitch: 1.16 },
  mox: { outfit: "bowtie" },
  motif: "track",
};

export default skin;
