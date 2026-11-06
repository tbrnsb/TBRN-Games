/**
 * Poker (Texas Hold'em) - Server Logic
 * No-limit Hold'em with play chips, blinds, side pots and showdown.
 * Hole cards are private: they only ever appear in that player's own
 * controller state. The TV and other phones receive hand names only.
 */

import { secureShuffle } from "../../shared/secure-random.ts";
import { roundsOption } from "../../shared/game-options.ts";
import { captionFor } from "../../shared/interlude.ts";
import { playerStatKey } from "../../shared/results.ts";
import { standingsFromScores, type GameResult } from "../../shared/scoring.ts";

// Types defined inline to avoid import issues with Node type stripping
interface GameManifest {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  controllerType: ControllerType;
  description: string;
}

type ControllerType =
  | "one-button"
  | "left-right"
  | "dpad"
  | "text"
  | "choice"
  | "private-grid"
  | "card-hand"
  | "slider"
  | "dual-slider"
  | "pad"
  | "aim"
  | "tap-race"
  | "board"
  | "numpad"
  | "canvas"
  | "chat";

interface Player {
  id: string;
  name: string;
  joinedAt: number;
  rejoinToken: string;
  connected: boolean;
  controllerType?: string;
}

interface RoomState {
  id: string;
  code: string;
  hostPlayerId: string | null;
  players: Player[];
  gameId: string | null;
  gameState: unknown | null;
  createdAt: number;
  status: "lobby" | "playing" | "finished";
}

interface GameInstance {
  roomId: string;
  players: Player[];
  state: unknown;
}

interface GamePlugin {
  manifest: GameManifest;
  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
  results?(instance: GameInstance): GameResult;
}

// --- Poker Types ---
type Suit = "hearts" | "diamonds" | "clubs" | "spades";

interface Card {
  suit: Suit;
  rank: number; // 2..14 (14 = Ace)
}

interface ShowdownReveal {
  name: string;
  handName: string;
}

interface PotResult {
  amount: number;
  winners: string[];
}

/** One pot as the TV should see it: the main pot or a numbered side pot. */
interface PotView {
  amount: number;
  label: string;
}

interface SeatState {
  chips: number;
  bet: number; // committed this street
  totalBet: number; // committed this hand (drives side pots)
  folded: boolean;
  allIn: boolean;
  cards: Card[];
  acted: boolean;
  lastAction: string | null;
}

type Phase = "preflop" | "flop" | "turn" | "river" | "showdown" | "hand-end" | "finished";

interface PokerState {
  seats: SeatState[];
  deck: Card[];
  community: Card[];
  pot: number; // collected (closed) chips
  dealerIndex: number;
  sbIndex: number;
  bbIndex: number;
  currentBet: number;
  lastRaiseSize: number;
  turnIndex: number; // -1 when nobody is acting (all-in runout)
  phase: Phase;
  handNumber: number;
  maxHands: number;
  actionTimerMs: number; // countdown for the current turn
  transitionTimerMs: number; // countdown for phase transitions
  awaitingTransition: "deal-next" | null;
  showdown: ShowdownReveal[] | null;
  potBreakdown: PotResult[] | null;
  results: string[] | null;
  finished: boolean;
  winnerIndex: number | null;
  /** Rumble mode: eight hands by default, blinds double at hand five. */
  rumble: boolean;
  smallBlind: number;
  bigBlind: number;
  /** Seat indices in the order they busted, oldest out first. */
  eliminationOrder: number[];
  /** Chips each seat held before the blinds of the current hand. */
  handStartChips: number[];
  /** Hands won (at least one pot) and the biggest pot won, per seat. */
  handsWon: number[];
  biggestPot: number[];
  /** Scratch flags: a seat won a pot in the hand being played. */
  wonThisHand: boolean[];
}

interface PokerInstance extends GameInstance {
  state: PokerState;
}

// --- Constants ---
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_HANDS = 12;
/** Rumble defaults: eight hands, and the blinds double at hand five. */
const RUMBLE_MAX_HANDS = 8;
const RUMBLE_BLIND_DOUBLE_HAND = 5;
const ACTION_TIMEOUT_MS = 25000;
const DEAL_DELAY_MS = 2500;
const SHOWDOWN_DELAY_MS = 6000;
const HAND_END_DELAY_MS = 6000;

const SUITS: Suit[] = ["hearts", "diamonds", "clubs", "spades"];
const RANK_LABELS: Record<number, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "10", 11: "J", 12: "Q", 13: "K", 14: "A",
};

const manifest: GameManifest = {
  id: "poker",
  name: "Texas Hold'em",
  minPlayers: 2,
  maxPlayers: 8,
  controllerType: "card-hand",
  description:
    "Texas Hold'em poker with play chips. Laptop shows community cards, phones show hole cards and bet buttons.",
};

// --- Deck helpers ---
function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

// Use secureShuffle from shared/secure-random.ts

function cardLabel(card: Card): { suit: Suit; rank: string } {
  return { suit: card.suit, rank: RANK_LABELS[card.rank] ?? String(card.rank) };
}

// --- Hand evaluation ---
export interface HandEval {
  category: number; // 0 high card .. 8 straight flush
  values: number[]; // tiebreakers, compared lexicographically
  name: string;
}

function compareEval(a: HandEval, b: HandEval): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < len; i++) {
    const av = a.values[i] ?? 0;
    const bv = b.values[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Evaluate the best 5-card hand from 5..7 cards. */
export function evaluateHand(cards: Card[]): HandEval {
  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranksDesc) counts.set(r, (counts.get(r) ?? 0) + 1);

  // Groups sorted by count desc, then rank desc.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  const isFlush =
    cards.length >= 5 && cards.every((c) => c.suit === cards[0].suit);

  // Straight high card (0 = no straight). Ace can play low (A-2-3-4-5).
  const unique = [...new Set(ranksDesc)];
  let straightHigh = 0;
  if (unique.length >= 5) {
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) {
        straightHigh = unique[i];
        break;
      }
    }
    if (
      straightHigh === 0 &&
      unique.includes(14) &&
      unique.includes(5) &&
      unique.includes(4) &&
      unique.includes(3) &&
      unique.includes(2)
    ) {
      straightHigh = 5;
    }
  }

  // Kickers: ranks that are not part of a paired/trips/quad group, desc.
  const pairedRanks = new Set(groups.filter((g) => g[1] >= 2).map((g) => g[0]));
  const kickers = ranksDesc.filter((r) => !pairedRanks.has(r));

  if (isFlush && straightHigh) {
    return {
      category: 8,
      values: [straightHigh],
      name: straightHigh === 14 ? "Royal Flush" : "Straight Flush",
    };
  }
  if (groups[0][1] === 4) {
    return { category: 7, values: [groups[0][0], groups[1][0]], name: "Four of a Kind" };
  }
  if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) {
    return { category: 6, values: [groups[0][0], groups[1][0]], name: "Full House" };
  }
  if (isFlush) {
    return { category: 5, values: ranksDesc.slice(0, 5), name: "Flush" };
  }
  if (straightHigh) {
    return { category: 4, values: [straightHigh], name: "Straight" };
  }
  if (groups[0][1] === 3) {
    return {
      category: 3,
      values: [groups[0][0], ...kickers.slice(0, 2)],
      name: "Three of a Kind",
    };
  }
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    const pairHigh = Math.max(groups[0][0], groups[1][0]);
    const pairLow = Math.min(groups[0][0], groups[1][0]);
    return { category: 2, values: [pairHigh, pairLow, kickers[0]], name: "Two Pair" };
  }
  if (groups[0][1] === 2) {
    return {
      category: 1,
      values: [groups[0][0], ...kickers.slice(0, 3)],
      name: "Pair",
    };
  }
  return { category: 0, values: ranksDesc.slice(0, 5), name: "High Card" };
}

// --- Seat helpers ---
function isLive(s: PokerState, i: number): boolean {
  return !s.seats[i].folded;
}

function canActIndices(s: PokerState): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i];
    if (!seat.folded && !seat.allIn && seat.chips > 0) out.push(i);
  }
  return out;
}

function needsToAct(s: PokerState, i: number): boolean {
  const seat = s.seats[i];
  return !seat.folded && !seat.allIn && (!seat.acted || seat.bet < s.currentBet);
}

function nextSeat(s: PokerState, from: number, pred: (i: number) => boolean): number {
  const n = s.seats.length;
  for (let step = 1; step <= n; step++) {
    const i = ((from + step) % n + n) % n;
    if (pred(i)) return i;
  }
  return -1;
}

function potTotal(s: PokerState): number {
  let total = s.pot;
  for (const seat of s.seats) total += seat.bet;
  return total;
}

/**
 * True when a seat is out of the tournament. A player who is all-in for the
 * current hand has zero chips behind but is still live until the pot is
 * awarded, so `allIn` has to clear before the seat counts as busted.
 */
function isOutSeat(s: PokerState, i: number): boolean {
  return s.eliminationOrder.includes(i) || (s.seats[i].chips <= 0 && !s.seats[i].allIn);
}

/** The public seat rows both the TV and every phone may see. */
function publicPlayers(instance: PokerInstance): Array<{
  name: string;
  chips: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  out: boolean;
  isDealer: boolean;
  isSB: boolean;
  isBB: boolean;
  lastAction: string | null;
  connected: boolean;
}> {
  const s = instance.state;
  return instance.players.map((player, i) => {
    const seat = s.seats[i];
    return {
      name: player.name,
      chips: seat.chips,
      bet: seat.bet,
      folded: seat.folded,
      allIn: seat.allIn,
      out: isOutSeat(s, i),
      isDealer: i === s.dealerIndex,
      isSB: i === s.sbIndex,
      isBB: i === s.bbIndex,
      lastAction: seat.lastAction,
      connected: player.connected,
    };
  });
}

/**
 * Split every chip committed this hand into the main pot and side pots.
 *
 * Levels come from the distinct `totalBet` values, so folded chips stay in the
 * pots as dead money and an uncalled top-up becomes a single-eligible pot that
 * is returned to its owner at showdown. Amounts are correct mid-hand too
 * because `totalBet` already includes the live street bets.
 */
function computePots(s: PokerState): PotView[] {
  const levels = [...new Set(s.seats.map((seat) => seat.totalBet).filter((total) => total > 0))]
    .sort((a, b) => a - b);
  const pots: PotView[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const seat of s.seats) {
      if (seat.totalBet >= level) amount += level - previous;
    }
    previous = level;
    if (amount <= 0) continue;
    pots.push({ amount, label: pots.length === 0 ? "POT" : `SIDE ${pots.length}` });
  }
  return pots;
}

// --- Hand flow ---
function postBlind(seat: SeatState, amount: number, label: string): void {
  const pay = Math.min(amount, seat.chips);
  seat.chips -= pay;
  seat.bet += pay;
  seat.totalBet += pay;
  if (seat.chips === 0) seat.allIn = true;
  seat.lastAction = `${label} ${pay}`;
}

function dealTo(s: PokerState, count: number): void {
  for (let i = 0; i < count; i++) {
    const card = s.deck.pop();
    if (card) s.community.push(card);
  }
}

function startHand(instance: PokerInstance): void {
  const s = instance.state;
  s.handNumber++;
  s.deck = secureShuffle(makeDeck());
  s.community = [];
  s.pot = 0;
  s.showdown = null;
  s.potBreakdown = null;
  s.results = null;
  s.currentBet = 0;
  s.turnIndex = -1;
  s.awaitingTransition = null;

  for (const seat of s.seats) {
    seat.folded = seat.chips <= 0;
    seat.allIn = false;
    seat.bet = 0;
    seat.totalBet = 0;
    seat.cards = [];
    seat.acted = false;
    seat.lastAction = null;
  }
  s.handStartChips = s.seats.map((seat) => seat.chips);
  s.wonThisHand = s.seats.map(() => false);

  const live = s.seats.map((_, i) => i).filter((i) => s.seats[i].chips > 0);
  if (live.length <= 1) {
    endGame(s);
    return;
  }

  // Rumble mode doubles the blinds once, from the fifth hand.
  s.smallBlind =
    s.rumble && s.handNumber >= RUMBLE_BLIND_DOUBLE_HAND ? SMALL_BLIND * 2 : SMALL_BLIND;
  s.bigBlind = s.smallBlind * 2;
  s.lastRaiseSize = s.bigBlind;

  s.dealerIndex = nextSeat(s, s.dealerIndex, (i) => s.seats[i].chips > 0);
  if (live.length === 2) {
    // Heads-up: dealer posts the small blind and acts first preflop.
    s.sbIndex = s.dealerIndex;
    s.bbIndex = nextSeat(s, s.dealerIndex, (i) => s.seats[i].chips > 0);
  } else {
    s.sbIndex = nextSeat(s, s.dealerIndex, (i) => s.seats[i].chips > 0);
    s.bbIndex = nextSeat(s, s.sbIndex, (i) => s.seats[i].chips > 0);
  }

  postBlind(s.seats[s.sbIndex], s.smallBlind, "small blind");
  postBlind(s.seats[s.bbIndex], s.bigBlind, "big blind");
  s.currentBet = Math.max(s.seats[s.sbIndex].bet, s.seats[s.bbIndex].bet);
  s.lastRaiseSize = s.bigBlind;

  // Deal two hole cards to every live player.
  for (let round = 0; round < 2; round++) {
    for (const i of live) {
      const card = s.deck.pop();
      if (card) s.seats[i].cards.push(card);
    }
  }

  s.phase = "preflop";
  // First to act is the seat after the big blind at every table size. Heads-up
  // that wraps back to the dealer/small blind, which is also correct. Using
  // `needsToAct` skips a blind who is all-in for less than the big blind, so
  // the action cannot get stuck on a player who cannot act.
  s.turnIndex = nextSeat(s, s.bbIndex, (i) => needsToAct(s, i));
  s.actionTimerMs = ACTION_TIMEOUT_MS;

  if (s.turnIndex === -1) {
    // Everyone is all-in from the blinds: run the board out.
    s.awaitingTransition = "deal-next";
    s.transitionTimerMs = DEAL_DELAY_MS;
  }
}

function commit(seat: SeatState, amount: number): void {
  const pay = Math.min(amount, seat.chips);
  seat.chips -= pay;
  seat.bet += pay;
  seat.totalBet += pay;
  if (seat.chips === 0) seat.allIn = true;
}

function collectBets(s: PokerState): void {
  for (const seat of s.seats) {
    s.pot += seat.bet;
    seat.bet = 0;
    seat.acted = false;
    seat.lastAction = null;
  }
}

/** Record a pot win for the hand-in-progress stats. */
function recordPotWin(s: PokerState, seat: number, amount: number): void {
  s.wonThisHand[seat] = true;
  if (amount > s.biggestPot[seat]) s.biggestPot[seat] = amount;
}

/** Count one hand won per seat that took at least one pot. Call once per hand. */
function finishHandWins(s: PokerState): void {
  for (let i = 0; i < s.wonThisHand.length; i++) {
    if (s.wonThisHand[i]) s.handsWon[i] += 1;
  }
  s.wonThisHand = s.wonThisHand.map(() => false);
}

function awardFoldWin(instance: PokerInstance): void {
  const s = instance.state;
  collectBets(s);
  const winnerIdx = nextSeat(s, -1, (i) => isLive(s, i));
  const amount = s.pot;
  s.seats[winnerIdx].chips += amount;
  s.pot = 0;
  recordPotWin(s, winnerIdx, amount);
  finishHandWins(s);
  s.results = [`${instance.players[winnerIdx].name} wins ${amount} (everyone else folded)`];
  s.potBreakdown = [{ amount, winners: [instance.players[winnerIdx].name] }];
  s.showdown = null;
  s.turnIndex = -1;
  s.phase = "showdown";
  s.transitionTimerMs = SHOWDOWN_DELAY_MS;
  markEliminations(s);
}

function toShowdown(instance: PokerInstance): void {
  const s = instance.state;
  collectBets(s);

  const contenders = s.seats.map((_, i) => i).filter((i) => isLive(s, i));
  const evals = new Map<number, HandEval>();
  for (const i of contenders) {
    evals.set(i, evaluateHand([...s.seats[i].cards, ...s.community]));
  }

  // Hand names are public at showdown; the hole cards themselves never are.
  s.showdown = contenders.map((i) => ({
    name: instance.players[i].name,
    handName: evals.get(i)?.name ?? "High Card",
  }));

  // Side pots by contribution level. Folded players' chips stay in the pots.
  const levels = [
    ...new Set(s.seats.map((seat) => seat.totalBet).filter((t) => t > 0)),
  ].sort((a, b) => a - b);

  s.potBreakdown = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const seat of s.seats) {
      if (seat.totalBet >= level) amount += level - prev;
    }
    prev = level;
    if (amount <= 0) continue;

    let eligible = contenders.filter((i) => s.seats[i].totalBet >= level);
    if (eligible.length === 0) eligible = contenders;

    let best = evals.get(eligible[0])!;
    let winners = [eligible[0]];
    for (const i of eligible.slice(1)) {
      const ev = evals.get(i)!;
      const cmp = compareEval(ev, best);
      if (cmp > 0) {
        best = ev;
        winners = [i];
      } else if (cmp === 0) {
        winners.push(i);
      }
    }

    const share = Math.floor(amount / winners.length);
    let remainder = amount - share * winners.length;
    for (const w of winners) {
      s.seats[w].chips += share;
      recordPotWin(s, w, amount);
    }
    // Remainder chips go around the table from the seat after the dealer.
    if (remainder > 0) {
      const order = [...winners].sort(
        (a, b) => nextSeat(s, s.dealerIndex, (i) => i === a) - nextSeat(s, s.dealerIndex, (i) => i === b),
      );
      for (const w of order) {
        if (remainder <= 0) break;
        s.seats[w].chips += 1;
        remainder -= 1;
      }
    }

    s.potBreakdown.push({
      amount,
      winners: winners.map((w) => instance.players[w].name),
    });
  }

  finishHandWins(s);
  s.pot = 0;
  s.results = s.potBreakdown.map(
    (p) => `${p.winners.join(" & ")} win ${p.amount}`,
  );
  s.turnIndex = -1;
  s.phase = "showdown";
  s.transitionTimerMs = SHOWDOWN_DELAY_MS;
  markEliminations(s);
}

/**
 * Record every seat that just lost its last chip, oldest out first.
 *
 * Seats busting in the same hand are ordered by the stack they held before the
 * hand: the shorter stack is treated as out first, so the bigger stack finishes
 * higher when the finishing order is reversed.
 */
function markEliminations(s: PokerState): void {
  const busted: number[] = [];
  for (let i = 0; i < s.seats.length; i++) {
    const seat = s.seats[i];
    if (seat.chips <= 0) {
      seat.folded = true;
      seat.allIn = false;
      // A busted spectator must not keep hole cards around.
      seat.cards = [];
      if (!s.eliminationOrder.includes(i)) busted.push(i);
    }
  }
  busted.sort(
    (a, b) => (s.handStartChips[a] ?? 0) - (s.handStartChips[b] ?? 0) || a - b,
  );
  s.eliminationOrder.push(...busted);
}

function endGame(s: PokerState): void {
  markEliminations(s);
  let bestIdx = 0;
  for (let i = 1; i < s.seats.length; i++) {
    if (s.seats[i].chips > s.seats[bestIdx].chips) bestIdx = i;
  }
  s.winnerIndex = bestIdx;
  s.finished = true;
  s.phase = "finished";
  s.turnIndex = -1;
}

function prepareNextHand(instance: PokerInstance): void {
  const s = instance.state;
  const live = s.seats.filter((seat) => seat.chips > 0).length;
  if (live <= 1 || s.handNumber >= s.maxHands) {
    endGame(s);
    return;
  }
  startHand(instance);
}

function dealNextStreet(s: PokerState): void {
  if (s.phase === "preflop") {
    dealTo(s, 3);
    s.phase = "flop";
  } else if (s.phase === "flop") {
    dealTo(s, 1);
    s.phase = "turn";
  } else if (s.phase === "turn") {
    dealTo(s, 1);
    s.phase = "river";
  }
}

function afterStreetDealt(s: PokerState): void {
  s.currentBet = 0;
  s.lastRaiseSize = s.bigBlind;
  const actors = canActIndices(s);
  if (actors.length <= 1) {
    // Not enough players to bet: run the rest of the board out.
    s.turnIndex = -1;
    s.awaitingTransition = "deal-next";
    s.transitionTimerMs = DEAL_DELAY_MS;
  } else {
    s.turnIndex = nextSeat(s, s.dealerIndex, (i) => isLive(s, i) && !s.seats[i].allIn);
    s.actionTimerMs = ACTION_TIMEOUT_MS;
  }
}

function endRound(instance: PokerInstance): void {
  const s = instance.state;
  collectBets(s);
  if (s.phase === "river") {
    toShowdown(instance);
    return;
  }
  dealNextStreet(s);
  afterStreetDealt(s);
}

function roundComplete(s: PokerState): boolean {
  for (const i of canActIndices(s)) {
    const seat = s.seats[i];
    if (!seat.acted || seat.bet !== s.currentBet) return false;
  }
  return true;
}

function afterAction(instance: PokerInstance): void {
  const s = instance.state;
  const liveCount = s.seats.filter((seat) => !seat.folded).length;
  if (liveCount === 1) {
    awardFoldWin(instance);
    return;
  }
  if (roundComplete(s)) {
    endRound(instance);
    return;
  }
  const next = nextSeat(s, s.turnIndex, (i) => needsToAct(s, i));
  s.turnIndex = next;
  s.actionTimerMs = ACTION_TIMEOUT_MS;
}

function autoAct(instance: PokerInstance): void {
  const s = instance.state;
  if (s.turnIndex < 0) return;
  const seat = s.seats[s.turnIndex];
  if (seat.folded || seat.allIn) return;
  if (seat.bet === s.currentBet) {
    seat.lastAction = "check (timeout)";
    seat.acted = true;
  } else {
    seat.folded = true;
    seat.lastAction = "fold (timeout)";
    seat.acted = true;
  }
  afterAction(instance);
}

// --- Plugin ---
const plugin: GamePlugin = {
  manifest,

  onStart(room: RoomState, players: Player[], options?: Record<string, unknown>): PokerInstance {
    // The host picks the stack and the number of hands. Everyone starts equal.
    // Precedence: an explicit `options.maxHands` wins, then the Rumble/catalog
    // `options.rounds`, then the mode default (eight in a Rumble, twelve
    // standalone).
    const rumble = options?.mode === "rumble";
    const rawStack = Number(options?.startingStack);
    const startingStack = Number.isFinite(rawStack)
      ? Math.min(100000, Math.max(100, Math.round(rawStack)))
      : STARTING_CHIPS;
    const rawHands = Number(options?.maxHands);
    const explicitRounds = roundsOption(options);
    const maxHands = Number.isFinite(rawHands)
      ? Math.min(50, Math.max(1, Math.round(rawHands)))
      : explicitRounds !== undefined
        ? Math.min(50, Math.max(1, explicitRounds))
        : rumble
          ? RUMBLE_MAX_HANDS
          : MAX_HANDS;

    const seats: SeatState[] = players.map(() => ({
      chips: startingStack,
      bet: 0,
      totalBet: 0,
      folded: false,
      allIn: false,
      cards: [],
      acted: false,
      lastAction: null,
    }));
    const instance: PokerInstance = {
      roomId: room.id,
      players,
      state: {
        seats,
        deck: [],
        community: [],
        pot: 0,
        dealerIndex: -1,
        sbIndex: -1,
        bbIndex: -1,
        currentBet: 0,
        lastRaiseSize: BIG_BLIND,
        turnIndex: -1,
        phase: "preflop",
        handNumber: 0,
        maxHands,
        actionTimerMs: ACTION_TIMEOUT_MS,
        transitionTimerMs: 0,
        awaitingTransition: null,
        showdown: null,
        potBreakdown: null,
        results: null,
        finished: false,
        winnerIndex: null,
        rumble,
        smallBlind: SMALL_BLIND,
        bigBlind: BIG_BLIND,
        eliminationOrder: [],
        handStartChips: seats.map((seat) => seat.chips),
        handsWon: players.map(() => 0),
        biggestPot: players.map(() => 0),
        wonThisHand: players.map(() => false),
      },
    };
    startHand(instance);
    return instance;
  },

  onInput(instance: PokerInstance, playerId: string, input: unknown): void {
    const s = instance.state;
    if (s.finished) return;
    if (s.phase !== "preflop" && s.phase !== "flop" && s.phase !== "turn" && s.phase !== "river") {
      return;
    }
    const seatIdx = instance.players.findIndex((p) => p.id === playerId);
    if (seatIdx === -1 || seatIdx !== s.turnIndex) return;
    const seat = s.seats[seatIdx];
    if (seat.folded || seat.allIn || isOutSeat(s, seatIdx)) return;

    const inp = input as { action?: string; amount?: number } | null;
    if (!inp || typeof inp.action !== "string") return;

    switch (inp.action) {
      case "fold": {
        seat.folded = true;
        seat.lastAction = "fold";
        seat.acted = true;
        break;
      }
      case "check": {
        if (seat.bet !== s.currentBet) return;
        seat.lastAction = "check";
        seat.acted = true;
        break;
      }
      case "call": {
        const need = s.currentBet - seat.bet;
        if (need <= 0) return; // check instead
        commit(seat, need);
        seat.lastAction = seat.allIn ? `all-in ${seat.bet}` : "call";
        seat.acted = true;
        break;
      }
      case "raise": {
        const to = Math.floor(Number(inp.amount));
        if (!Number.isFinite(to)) return;
        const maxTo = seat.bet + seat.chips;
        const minTo = s.currentBet + s.lastRaiseSize;
        if (to <= s.currentBet || to > maxTo) return;
        if (to < minTo && to < maxTo) return; // short of min-raise unless all-in
        if (to - s.currentBet >= s.lastRaiseSize) {
          s.lastRaiseSize = to - s.currentBet;
        }
        commit(seat, to - seat.bet);
        s.currentBet = seat.bet;
        seat.lastAction = seat.allIn ? `all-in to ${seat.bet}` : `raise to ${seat.bet}`;
        seat.acted = true;
        for (let i = 0; i < s.seats.length; i++) {
          if (i !== seatIdx && needsToAct(s, i)) s.seats[i].acted = false;
        }
        break;
      }
      default:
        return; // unknown action: ignore, server stays authoritative
    }
    afterAction(instance);
  },

  onTick(instance: PokerInstance, deltaMs: number): void {
    const s = instance.state;
    if (s.finished) return;
    const dt = Math.min(Math.max(deltaMs, 0), 2000);

    if (s.phase === "showdown" || s.phase === "hand-end") {
      s.transitionTimerMs -= dt;
      if (s.transitionTimerMs <= 0) {
        if (s.phase === "showdown") {
          s.phase = "hand-end";
          s.transitionTimerMs = HAND_END_DELAY_MS;
        } else {
          prepareNextHand(instance);
        }
      }
      return;
    }

    if (s.awaitingTransition === "deal-next") {
      s.transitionTimerMs -= dt;
      if (s.transitionTimerMs <= 0) {
        s.awaitingTransition = null;
        if (s.phase === "river") {
          toShowdown(instance);
        } else {
          dealNextStreet(s);
          afterStreetDealt(s);
        }
      }
      return;
    }

    if (s.turnIndex >= 0) {
      s.actionTimerMs -= dt;
      if (s.actionTimerMs <= 0) {
        autoAct(instance);
      }
    }
  },

  screenState(instance: PokerInstance): unknown {
    const s = instance.state;
    const turnPlayer = s.turnIndex >= 0 ? instance.players[s.turnIndex] : null;
    return {
      phase: s.phase,
      handNumber: s.handNumber,
      maxHands: s.maxHands,
      community: s.community.map(cardLabel),
      // `pot` stays the single total; `pots` is the main pot plus every side
      // pot, so the TV can show all-ins at more than one level.
      pot: potTotal(s),
      pots: s.finished ? [] : computePots(s),
      currentBet: s.currentBet,
      players: publicPlayers(instance),
      turnName: turnPlayer ? turnPlayer.name : null,
      waitingOn: turnPlayer ? [turnPlayer.name] : [],
      timeLeft: Math.max(0, s.actionTimerMs),
      // Public showdown only: hand names and winners, never hole cards.
      showdown: s.showdown
        ? s.showdown.map((r) => ({ name: r.name, handName: r.handName }))
        : null,
      potBreakdown: s.potBreakdown,
      results: s.results,
      caption: s.phase === "showdown" ? captionFor({ kind: "reveal", seed: s.handNumber }) : null,
      sound: s.phase === "showdown" ? "reveal" : null,
      finished: s.finished,
      winner:
        s.finished && s.winnerIndex !== null
          ? { name: instance.players[s.winnerIndex].name, chips: s.seats[s.winnerIndex].chips }
          : null,
    };
  },

  controllerState(instance: PokerInstance, playerId: string): unknown {
    const s = instance.state;
    const seatIdx = instance.players.findIndex((p) => p.id === playerId);
    if (seatIdx === -1) return { phase: s.phase, finished: s.finished };
    const seat = s.seats[seatIdx];

    // A busted player is a spectator: no hole cards, no action bar, no
    // ability to affect the tournament. Reactions stay platform-level.
    if (isOutSeat(s, seatIdx) && !s.finished) {
      return {
        spectator: true,
        out: true,
        phase: s.phase,
        handNumber: s.handNumber,
        maxHands: s.maxHands,
        chips: 0,
        pot: potTotal(s),
        players: publicPlayers(instance),
        results: s.results,
        finished: s.finished,
      };
    }

    const betting =
      s.phase === "preflop" || s.phase === "flop" || s.phase === "turn" || s.phase === "river";
    const yourTurn = betting && s.turnIndex === seatIdx && !s.finished;
    const toCall = Math.max(0, s.currentBet - seat.bet);
    const maxRaiseTo = seat.bet + seat.chips;
    const minRaiseTo = s.currentBet + s.lastRaiseSize;

    return {
      phase: s.phase,
      handNumber: s.handNumber,
      maxHands: s.maxHands,
      cards: seat.cards.map(cardLabel),
      community: s.community.map(cardLabel),
      chips: seat.chips,
      bet: seat.bet,
      pot: potTotal(s),
      pots: s.finished ? [] : computePots(s),
      toCall,
      canCheck: yourTurn && toCall === 0,
      canCall: yourTurn && toCall > 0 && seat.chips > 0,
      callAmount: Math.min(toCall, seat.chips),
      canRaise: yourTurn && seat.chips > toCall && maxRaiseTo > s.currentBet,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      raiseStep: Math.max(1, s.lastRaiseSize),
      yourTurn,
      turnName: s.turnIndex >= 0 ? instance.players[s.turnIndex].name : null,
      timeLeft: Math.max(0, s.actionTimerMs),
      folded: seat.folded,
      allIn: seat.allIn,
      out: isOutSeat(s, seatIdx),
      dealerIndex: s.dealerIndex,
      players: publicPlayers(instance),
      showdown: s.showdown
        ? s.showdown.map((r) => ({ name: r.name, handName: r.handName }))
        : null,
      results: s.results,
      finished: s.finished,
      youWon: s.finished && s.winnerIndex === seatIdx,
    };
  },

  /**
   * Final standings and award stats.
   *
   * Live players are ranked by stack (ties share a rank through the shared
   * helper). Busted players follow newest-out first, so the first player
   * eliminated finishes last. Raw is always the final chip stack.
   */
  results(instance: PokerInstance): GameResult {
    const s = instance.state;
    const live = s.seats
      .map((seat, index) => ({ seat, index }))
      .filter(({ seat, index }) => seat.chips > 0 || !isOutSeat(s, index));

    const standings = standingsFromScores(
      live.map(({ seat, index }) => ({ id: instance.players[index].id, raw: seat.chips })),
    );
    // The live block occupies ranks 1..live.length, including every position
    // held by a tie, so the first busted player takes the next position.
    let nextRank = live.length + 1;

    const busted = [...s.eliminationOrder].reverse();
    for (const index of busted) {
      standings.push({
        playerId: instance.players[index].id,
        rank: nextRank,
        raw: s.seats[index].chips,
      });
      nextRank += 1;
    }

    const stats: Record<string, number> = {};
    const biggestPot = s.biggestPot.reduce((highest, amount) => Math.max(highest, amount), 0);
    stats.biggestPot = biggestPot;
    instance.players.forEach((player, index) => {
      stats[playerStatKey(player.id, "handsWon")] = s.handsWon[index] ?? 0;
      stats[playerStatKey(player.id, "biggestPot")] = s.biggestPot[index] ?? 0;
    });

    return { standings, stats };
  },
};

export default plugin;
