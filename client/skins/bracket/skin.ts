import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "bracket",
  title: "Bracket Brawl",
  vibe: "Pro-wrestling tournament poster",
  paper: "cream",
  inks: ["tomato","cobalt"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Anton\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["tape","torn-edge","star"],
  enter: "stamp",
  sound: { bank: "circus", hostPitch: 1.18 },
  mox: { outfit: "party" },
  motif: "checker",
};

export default skin;
