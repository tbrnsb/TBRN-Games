/**
 * Generate the per-game skin files from the DESIGN.md v2 table.
 * Run: node scripts/generate-skins.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const skins = [
  { id: "archery", title: "Archery", vibe: "Medieval tournament woodcut poster", paper: "butter", inks: ["tomato", "teal"], display: "Pirata One", motif: "target", enter: "slide-tilt", bank: "wood", pitch: 0.82, outfit: "tophat", props: ["tape", "coffee-ring", "scribble"] },
  { id: "bluff", title: "Bluff", vibe: "Carnival barker banner and stage curtains", paper: "cream", inks: ["tomato", "sun"], display: "Rye", motif: "curtain", enter: "curtain", bank: "brass", pitch: 1.12, outfit: "bowtie", props: ["tape", "star", "scribble"] },
  { id: "darts", title: "Darts", vibe: "Pub chalkboard with beer-mat scoreboard", paper: "chalkboard", inks: ["sun", "bubblegum"], display: "Caveat Brush", motif: "dartboard", enter: "stamp", bank: "chalk", pitch: 0.94, outfit: "sunglasses", props: ["coffee-ring", "torn-edge", "scribble"] },
  { id: "golf", title: "Golf", vibe: "Putt-putt course sign and pencil scorecard", paper: "mint", inks: ["grass", "sun"], display: "Lilita One", motif: "flag", enter: "drop", bank: "plop", pitch: 1.06, outfit: "bowtie", props: ["tape", "fold", "star"] },
  { id: "gravityrun", title: "Gravity Run", vibe: "Comic-book panels with halftone space", paper: "night", inks: ["sky", "bubblegum"], display: "Bangers", motif: "planet", enter: "stamp", bank: "comic", pitch: 1.24, outfit: "sunglasses", props: ["torn-edge", "star", "scribble"] },
  { id: "guesswho", title: "Guess Who", vibe: "Detective case file with polaroid mugshots", paper: "kraft", inks: ["cobalt", "tomato"], display: "Special Elite", motif: "magnifier", enter: "slide-tilt", bank: "typewriter", pitch: 0.9, outfit: "detective", props: ["paperclip", "tape", "coffee-ring"] },
  { id: "hangman", title: "Hangman", vibe: "School notebook doodle page", paper: "cream", inks: ["cobalt", "tomato"], display: "Patrick Hand", motif: "gallows", enter: "unfold", bank: "pencil", pitch: 1.0, outfit: "party", props: ["tape", "scribble", "fold"] },
  { id: "knifethrow", title: "Knife Throw", vibe: "Circus poster with a spinning wheel", paper: "butter", inks: ["tomato", "cobalt"], display: "Bowlby One", motif: "knife", enter: "drop", bank: "circus", pitch: 1.18, outfit: "tophat", props: ["star", "torn-edge", "scribble"] },
  { id: "mostlikely", title: "Most Likely To", vibe: "School yearbook superlatives", paper: "cream", inks: ["cobalt", "sun"], display: "DM Serif Display", motif: "yearbook", enter: "slide-tilt", bank: "yearbook", pitch: 1.04, outfit: "bowtie", props: ["paperclip", "tape", "star"] },
  { id: "poker", title: "Poker", vibe: "Kitchen-table card night with felt and chips", paper: "felt", inks: ["sun", "tomato"], display: "Alfa Slab One", motif: "cards", enter: "stamp", bank: "chips", pitch: 0.86, outfit: "sunglasses", props: ["coffee-ring", "tape", "scribble"] },
  { id: "quiz", title: "Quiz", vibe: "Retro TV game-show set", paper: "cream", inks: ["cobalt", "sun"], display: "Titan One", motif: "tv", enter: "curtain", bank: "buzzer", pitch: 1.1, outfit: "party", props: ["star", "tape", "coffee-ring"] },
  { id: "racing", title: "Racing", vibe: "Vintage Grand Prix poster", paper: "cream", inks: ["tangerine", "teal"], display: "Anton", motif: "checker", enter: "slide-tilt", bank: "engine", pitch: 1.0, outfit: "tophat", props: ["torn-edge", "scribble", "star"] },
  { id: "seabattle", title: "Sea Battle", vibe: "Nautical chart on graph paper", paper: "mint", inks: ["cobalt", "tomato"], display: "Bungee", motif: "ship", enter: "unfold", bank: "sonar", pitch: 0.78, outfit: "detective", props: ["paperclip", "coffee-ring", "tape"] },
  { id: "slotcar", title: "Slot Car", vibe: "1960s toy-catalog spread", paper: "cream", inks: ["tangerine", "sky"], display: "Shrikhand", motif: "track", enter: "slide-tilt", bank: "slot", pitch: 1.16, outfit: "bowtie", props: ["star", "fold", "torn-edge"] },
  { id: "snakes", title: "Snakes", vibe: "Board-game box lid and wooden board", paper: "butter", inks: ["grass", "grape"], display: "Modak", motif: "snake", enter: "unfold", bank: "dice", pitch: 1.08, outfit: "party", props: ["tape", "star", "scribble"] },
  { id: "spinwar", title: "Spin War", vibe: "Spinning-top battle on a carnival tray", paper: "cream", inks: ["grape", "tangerine"], display: "Rubik Mono One", motif: "top", enter: "stamp", bank: "whirr", pitch: 1.22, outfit: "sunglasses", props: ["star", "scribble", "torn-edge"] },
  { id: "trafficjam", title: "Traffic Jam", vibe: "City street map with sticky arrows", paper: "newsprint", inks: ["sun", "cobalt"], display: "Oswald", motif: "car", enter: "slide-tilt", bank: "horns", pitch: 0.96, outfit: "detective", props: ["tape", "pin", "scribble"] },
  { id: "writevote", title: "Write & Vote", vibe: "Corkboard with sticky notes and marker", paper: "kraft", inks: ["bubblegum", "teal"], display: "Permanent Marker", motif: "note", enter: "drop", bank: "marker", pitch: 1.02, outfit: "bowtie", props: ["pin", "tape", "scribble"] },
];

const fontBody = '"Atkinson Hyperlegible", sans-serif';

for (const s of skins) {
  const dir = join(root, "client", "skins", s.id);
  mkdirSync(dir, { recursive: true });
  const file = `import type { Skin } from "../../kit/types.ts";

const skin: Skin = {
  id: ${JSON.stringify(s.id)},
  title: ${JSON.stringify(s.title)},
  vibe: ${JSON.stringify(s.vibe)},
  paper: ${JSON.stringify(s.paper)},
  inks: ${JSON.stringify(s.inks)} as [Skin["inks"][0], Skin["inks"][1]],
  fonts: { display: ${JSON.stringify(`"${s.display}", cursive`)}, body: ${JSON.stringify(fontBody)} },
  props: ${JSON.stringify(s.props)},
  enter: ${JSON.stringify(s.enter)},
  sound: { bank: ${JSON.stringify(s.bank)}, hostPitch: ${s.pitch} },
  mox: { outfit: ${JSON.stringify(s.outfit)} },
  motif: ${JSON.stringify(s.motif)},
};

export default skin;
`;
  writeFileSync(join(dir, "skin.ts"), file);
}

const index = `/** Generated by scripts/generate-skins.mjs. */
import type { Skin } from "../kit/types.ts";
${skins.map((s) => `import ${s.id} from "./${s.id}/skin.ts";`).join("\n")}

export const SKINS: Record<string, Skin> = {
${skins.map((s) => `  ${s.id},`).join("\n")}
};

export function skinFor(id: string): Skin | undefined {
  return SKINS[id];
}
`;
writeFileSync(join(root, "client", "skins", "index.ts"), index);
console.log(`[skins] wrote ${skins.length} skins`);
