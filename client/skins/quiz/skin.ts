import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "quiz",
  title: "Quiz",
  vibe: "Retro TV game-show set",
  paper: "cream",
  inks: ["cobalt","sun"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Titan One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["star","tape","coffee-ring"],
  enter: "curtain",
  sound: { bank: "buzzer", hostPitch: 1.1 },
  mox: { outfit: "party" },
  motif: "tv",
};

export default skin;
