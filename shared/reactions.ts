/**
 * Audience reactions.
 *
 * Exactly eight emoji are allowed so the TV can lay out a fixed reaction
 * palette and the phone bar never needs to page. The id is the stable wire
 * value; the emoji is presentation only and is always resolved on the server.
 */

export type ReactionId =
  | "laugh"
  | "wow"
  | "clap"
  | "love"
  | "fire"
  | "hype"
  | "think"
  | "sad";

export interface Reaction {
  id: ReactionId;
  emoji: string;
  /** Spoken label for the phone button's accessible name. */
  label: string;
}

export const REACTIONS: readonly Reaction[] = [
  { id: "laugh", emoji: "😂", label: "Laugh" },
  { id: "wow", emoji: "😮", label: "Wow" },
  { id: "clap", emoji: "👏", label: "Clap" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "fire", emoji: "🔥", label: "Fire" },
  { id: "hype", emoji: "💯", label: "Hype" },
  { id: "think", emoji: "🤔", label: "Thinking" },
  { id: "sad", emoji: "😢", label: "Sad" },
];

const BY_ID = new Map<string, Reaction>(REACTIONS.map((reaction) => [reaction.id, reaction]));

/** One reaction per player per this many milliseconds, on the server clock. */
export const REACTION_COOLDOWN_MS = 2000;

/** True when `id` is one of the eight allowed reaction ids. */
export function isReaction(id: unknown): id is ReactionId {
  return typeof id === "string" && BY_ID.has(id);
}

/** The reaction for an id, or null when the id is not allowed. */
export function reactionById(id: string): Reaction | null {
  return BY_ID.get(id) ?? null;
}
