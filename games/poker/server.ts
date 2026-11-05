/**
 * Poker (Texas Hold'em) - Server Logic
 * No-limit Hold'em with play chips, blinds, side pots and showdown.
 * Hole cards are private: they only ever appear in that player's
 * controller state (or in the public showdown reveal).
 */

import { secureShuffle } from "../../shared/secure-random.ts";

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
  onStart(room: RoomState, players: Player[]): GameInstance;
  onInput(instance: GameInstance, playerId: string, input: unknown): void;
  onTick(instance: GameInstance, deltaMs: number): void;
  screenState(instance: GameInstance): unknown;
  controllerState(instance: GameInstance, playerId: string): unknown;
}

// --- Poker Types ---
type Suit = "hearts" | "diamonds" | "clubs" | "spades";

interface Card {
  suit: Suit;
  rank: number; // 2..14 (14 = Ace)
}

interface ShowdownReveal {
  name: string;
  cards: Card[];
  handName: string;
}

interface PotResult {
  amount: number;
  winners: string[];
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
}

interface PokerInstance extends GameInstance {
  state: PokerState;
}

// --- Constants ---
const STARTING_CHIPS = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_HANDS = 12;
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
  maxPlayers: 4,
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
  s.lastRaiseSize = BIG_BLIND;
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

  const live = s.seats.map((_, i) => i).filter((i) => s.seats[i].chips > 0);
  if (live.length <= 1) {
    endGame(s);
    return;
  }

  s.dealerIndex = nextSeat(s, s.dealerIndex, (i) => s.seats[i].chips > 0);
  if (live.length === 2) {
    // Heads-up: dealer posts the small blind and acts first preflop.
    s.sbIndex = s.dealerIndex;
    s.bbIndex = nextSeat(s, s.dealerIndex, (i) => s.seats[i].chips > 0);
  } else {
    s.sbIndex = nextSeat(s, s.dealerIndex, (i) => s.seats[i].chips > 0);
    s.bbIndex = nextSeat(s, s.sbIndex, (i) => s.seats[i].chips > 0);
  }

  postBlind(s.seats[s.sbIndex], SMALL_BLIND, "small blind");
  postBlind(s.seats[s.bbIndex], BIG_BLIND, "big blind");
  s.currentBet = Math.max(s.seats[s.sbIndex].bet, s.seats[s.bbIndex].bet);
  s.lastRaiseSize = BIG_BLIND;

  // Deal two hole cards to every live player.
  for (let round = 0; round < 2; round++) {
    for (const i of live) {
      const card = s.deck.pop();
      if (card) s.seats[i].cards.push(card);
    }
  }

  s.phase = "preflop";
  const firstToAct =
    live.length === 2
      ? s.dealerIndex
      : nextSeat(s, s.bbIndex, (i) => needsToAct(s, i));
  s.turnIndex = firstToAct;
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

function awardFoldWin(instance: PokerInstance): void {
  const s = instance.state;
  collectBets(s);
  const winnerIdx = nextSeat(s, -1, (i) => isLive(s, i));
  const amount = s.pot;
  s.seats[winnerIdx].chips += amount;
  s.pot = 0;
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

  s.showdown = contenders.map((i) => ({
    name: instance.players[i].name,
    cards: [...s.seats[i].cards],
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

  s.pot = 0;
  s.results = s.potBreakdown.map(
    (p) => `${p.winners.join(" & ")} win ${p.amount}`,
  );
  s.turnIndex = -1;
  s.phase = "showdown";
  s.transitionTimerMs = SHOWDOWN_DELAY_MS;
  markEliminations(s);
}

function markEliminations(s: PokerState): void {
  for (const seat of s.seats) {
    if (seat.chips <= 0) {
      seat.folded = true;
      seat.allIn = false;
    }
  }
}

function endGame(s: PokerState): void {
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
  s.lastRaiseSize = BIG_BLIND;
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

  onStart(room: RoomState, players: Player[]): PokerInstance {
    const seats: SeatState[] = players.map(() => ({
      chips: STARTING_CHIPS,
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
        maxHands: MAX_HANDS,
        actionTimerMs: ACTION_TIMEOUT_MS,
        transitionTimerMs: 0,
        awaitingTransition: null,
        showdown: null,
        potBreakdown: null,
        results: null,
        finished: false,
        winnerIndex: null,
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
    if (seat.folded || seat.allIn) return;

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
    const players = instance.players.map((p, i) => {
      const seat = s.seats[i];
      return {
        name: p.name,
        chips: seat.chips,
        bet: seat.bet,
        folded: seat.folded,
        allIn: seat.allIn,
        out: seat.chips <= 0,
        isDealer: i === s.dealerIndex,
        isSB: i === s.sbIndex,
        isBB: i === s.bbIndex,
        lastAction: seat.lastAction,
        connected: p.connected,
      };
    });
    return {
      phase: s.phase,
      handNumber: s.handNumber,
      maxHands: s.maxHands,
      community: s.community.map(cardLabel),
      pot: potTotal(s),
      currentBet: s.currentBet,
      players,
      turnName: s.turnIndex >= 0 ? instance.players[s.turnIndex].name : null,
      timeLeft: Math.max(0, s.actionTimerMs),
      showdown: s.showdown
        ? s.showdown.map((r) => ({ name: r.name, cards: r.cards.map(cardLabel), handName: r.handName }))
        : null,
      potBreakdown: s.potBreakdown,
      results: s.results,
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
      toCall,
      canCheck: yourTurn && toCall === 0,
      canCall: yourTurn && toCall > 0 && seat.chips > 0,
      callAmount: Math.min(toCall, seat.chips),
      canRaise: yourTurn && seat.chips > toCall && maxRaiseTo > s.currentBet,
      minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
      maxRaiseTo,
      yourTurn,
      timeLeft: Math.max(0, s.actionTimerMs),
      folded: seat.folded,
      allIn: seat.allIn,
      out: seat.chips <= 0,
      dealerIndex: s.dealerIndex,
      players: instance.players.map((p, i) => ({
        name: p.name,
        chips: s.seats[i].chips,
        bet: s.seats[i].bet,
        folded: s.seats[i].folded,
        allIn: s.seats[i].allIn,
        out: s.seats[i].chips <= 0,
        isDealer: i === s.dealerIndex,
        lastAction: s.seats[i].lastAction,
      })),
      showdown: s.showdown
        ? s.showdown.map((r) => ({ name: r.name, cards: r.cards.map(cardLabel), handName: r.handName }))
        : null,
      results: s.results,
      finished: s.finished,
      youWon: s.finished && s.winnerIndex === seatIdx,
    };
  },
};

export default plugin;
