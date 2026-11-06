/** Short, warm host lines. Four+ variants per event; no TTS. */

export type MoxEvent =
  | "join"
  | "gameStart"
  | "allSubmitted"
  | "reveal"
  | "tie"
  | "bigWin"
  | "roundEnd"
  | "winner"
  | "disconnect"
  | "quizQuestion"
  | "quizReveal";

const LINES: Record<MoxEvent, string[]> = {
  join: [
    "Another pair of hands. Good.",
    "Welcome in. Pick a box, not a fight.",
    "There's paper everywhere already. Sit down.",
    "The table's better with you on it.",
  ],
  gameStart: [
    "Opening {game}. No pressure.",
    "Right. {game}. Try to look clever.",
    "{game} is on the table. Be gentle with it.",
    "Here comes {game}. Mind the paper cuts.",
  ],
  allSubmitted: [
    "Everything's in. Nobody panic.",
    "All the answers are on the table.",
    "That's everyone. Let's see the damage.",
    "Submissions closed. I'm judging quietly.",
  ],
  reveal: [
    "And the paper says...",
    "Let's peel this one back.",
    "Time to see who was paying attention.",
    "Here's the bit everyone came for.",
  ],
  tie: [
    "A tie. How diplomatic.",
    "Nobody wins. Everybody wins. Pick one.",
    "A dead heat. I'll get the ruler.",
    "Shared glory. Shared blame.",
  ],
  bigWin: [
    "That's a stamp worth framing.",
    "Somebody's been practicing.",
    "A big one. The table felt that.",
    "That score needs its own chair.",
  ],
  roundEnd: [
    "Round's done. Shuffle the paper.",
    "That's one sheet down.",
    "Take a breath. Then take a box.",
    "Next round. Same table, new mess.",
  ],
  winner: [
    "The champion. Try to be humble.",
    "A winner. The paper has spoken.",
    "Take the trophy. It's mostly cardboard.",
    "Well played. Now help clear up.",
  ],
  disconnect: [
    "Someone's signal wandered off.",
    "A phone has left the table. Rude.",
    "We'll hold their seat. Probably.",
    "Connection lost. The paper remains.",
  ],
  quizQuestion: [
    "Question {round}. Eyes on the paper.",
    "Here's one. No Googling.",
    "Question {round}. Think fast.",
    "Next question. You've got this. Maybe.",
  ],
  quizReveal: [
    "{answer}. Obviously.",
    "The answer was {answer}. Be honest.",
    "{answer}. I could have told you.",
    "It's {answer}. Write it down.",
  ],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function moxLine(event: MoxEvent, context: Record<string, string | number> = {}, seed = ""): string {
  const variants = LINES[event];
  const pick = variants[hash(`${event}:${seed}`) % variants.length];
  return pick.replace(/\{(\w+)\}/g, (_match, key: string) => String(context[key] ?? ""));
}
