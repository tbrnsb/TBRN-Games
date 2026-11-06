import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: "spinwar",
  title: "Spin War",
  vibe: "Spinning-top battle on a carnival tray",
  paper: "cream",
  inks: ["grape","tangerine"] as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: "\"Rubik Mono One\", cursive", body: "\"Atkinson Hyperlegible\", sans-serif" },
  props: ["star","scribble","torn-edge"],
  enter: "stamp",
  sound: { bank: "whirr", hostPitch: 1.22 },
  mox: { outfit: "sunglasses" },
  motif: "top",
};

export default skin;
