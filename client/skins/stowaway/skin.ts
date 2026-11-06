import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "stowaway",
  title: "Stowaway",
  vibe: "Ship cargo manifest and stencilled crates",
  paper: "kraft",
  inks: ["teal","tomato"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Special Elite\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["paperclip","coffee-ring","tape"],
  enter: "slide-tilt",
  sound: { bank: "sonar", hostPitch: 0.84 },
  mox: { outfit: "detective" },
  motif: "ship",
};

export default skin;
