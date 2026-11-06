/** Paper-and-ink identity types. */

export type PaperId =
  | "cream"
  | "newsprint"
  | "kraft"
  | "butter"
  | "mint"
  | "pale-pink"
  | "chalkboard"
  | "blueprint"
  | "felt"
  | "night";

export type InkId =
  | "bubblegum"
  | "tomato"
  | "tangerine"
  | "sun"
  | "grass"
  | "teal"
  | "sky"
  | "cobalt"
  | "grape"
  | "ink";

export type EnterStyle = "slide-tilt" | "stamp" | "drop" | "unfold" | "curtain";

export type MoxOutfit =
  | "bowtie"
  | "tophat"
  | "sunglasses"
  | "detective"
  | "chef"
  | "party"
  | "none";

export type MotifId =
  | "target"
  | "curtain"
  | "dartboard"
  | "flag"
  | "planet"
  | "magnifier"
  | "gallows"
  | "knife"
  | "yearbook"
  | "cards"
  | "tv"
  | "checker"
  | "ship"
  | "track"
  | "snake"
  | "top"
  | "car"
  | "note";

export interface Skin {
  id: string;
  title: string;
  vibe: string;
  paper: PaperId;
  inks: [InkId, InkId];
  fonts: { display: string; body: string; accent?: string };
  props: string[];
  enter: EnterStyle;
  sound: { bank: string; hostPitch: number };
  mox: { outfit: MoxOutfit };
  motif: MotifId;
}
