/**
 * Hangman — Premium Screen Renderer
 * Synthwave + Bento Grid + Swiss Typography
 * Uses the shared kit from client/screen/kit/
 *
 * Spectator view: gallows, the masked word, guessed letters and scores.
 * The word is only revealed by the server at round end.
 */

import {
  colors, fonts, scaleForViewport, scaledSize,
  drawSynthwaveBackground,
  drawBentoCard, drawScoreboard,
  emitScoreBurst, emitHitBurst, updateParticles, drawParticles,
  createShake, triggerShake, applyShakeTransform,
  createTitleCard, showTitleCard, updateTitleCard, drawTitleCard, isTitleCardDone,
  createVictoryScreen, showVictoryScreen, updateVictoryScreen, drawVictoryScreen, buildRankedEntries,
  drawRoundRect, clamp,
} from "../../client/screen/kit/index.ts";

interface HangmanScreenState {
  word: string;
  masked: string;
  guessed: string[];
  wrongGuesses: number;
  maxWrong: number;
  currentPlayer: number;
  round: number;
  maxRounds: number;
  phase: "playing" | "round-end" | "finished";
  scores: Array<{ name: string; score: number }>;
  finished: boolean;
  winner: { name: string; score: number } | null;
}

interface HangmanRenderState {
  titleCard: ReturnType<typeof createTitleCard> | null;
  victoryScreen: ReturnType<typeof createVictoryScreen> | null;
  shake: ReturnType<typeof createShake>;
  lastUpdate: number;
  lastPhase: string;
  lastRound: number;
  lastWrong: number;
  lastScores: number[];
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function createHangmanRenderState(): HangmanRenderState {
  return {
    titleCard: null,
    victoryScreen: null,
    shake: createShake(6, 250),
    lastUpdate: 0,
    lastPhase: "",
    lastRound: 0,
    lastWrong: 0,
    lastScores: [],
  };
}

const renderState = (globalThis as any)._hangmanRenderState ||= createHangmanRenderState();

export function renderHangman(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: HangmanScreenState,
): void {
  const scale = scaleForViewport(width, height);
  const rs: HangmanRenderState = renderState;
  const now = performance.now();
  const dt = rs.lastUpdate ? Math.min(now - rs.lastUpdate, 100) : 16;
  rs.lastUpdate = now;

  ctx.save();
  try {
    drawSynthwaveBackground(ctx, { width, height, time: now });
    applyShakeTransform(ctx, rs.shake, now);
    updateParticles(dt);

    if (state.wrongGuesses > rs.lastWrong) {
      triggerShake(rs.shake, 0.22, now);
      emitHitBurst(width * 0.28, height * 0.5, colors.danger, scale);
    }
    rs.lastWrong = state.wrongGuesses;
    state.scores.forEach((p, i) => {
      const prev = rs.lastScores[i];
      if (prev !== undefined && p.score > prev) {
        emitScoreBurst(width * 0.5, height * 0.22, i, scale);
      }
      rs.lastScores[i] = p.score;
    });

    if (state.round !== rs.lastRound) {
      rs.lastRound = state.round;
    }
    if (state.phase !== rs.lastPhase) {
      handlePhaseChange(state, rs, now, width, height);
      rs.lastPhase = state.phase;
    }
    if (!state.finished && rs.victoryScreen) rs.victoryScreen = null;
    // The title card belongs to one game: drop it when the game ends so the
    // next game in the same room gets its own.
    if (state.finished) rs.titleCard = null;

    if (rs.titleCard) updateTitleCard(rs.titleCard, now);
    if (rs.victoryScreen) updateVictoryScreen(rs.victoryScreen, now, dt);

    if (state.finished && rs.victoryScreen) {
      drawVictoryScreen(ctx, width, height, rs.victoryScreen);
      return;
    }
    if (rs.titleCard && !isTitleCardDone(rs.titleCard)) {
      drawTitleCard(ctx, width, height, rs.titleCard);
      return;
    }

    drawHeader(ctx, width, height, state, scale);
    drawGallows(ctx, width, height, state, scale);
    drawWord(ctx, width, height, state, scale, now);
    drawAlphabet(ctx, width, height, state, scale);
    drawRail(ctx, width, height, state, scale);
    drawParticles(ctx);
  } finally {
    ctx.restore();
  }
}

function handlePhaseChange(
  state: HangmanScreenState,
  rs: HangmanRenderState,
  now: number,
  width: number,
  height: number,
): void {
  if (state.phase === "playing" && !rs.titleCard) {
    rs.titleCard = createTitleCard({
      title: "HANGMAN",
      subtitle: "Guess the word before the rope",
      duration: 2100,
      fadeInDuration: 450,
      holdDuration: 1000,
      fadeOutDuration: 500,
    });
    showTitleCard(rs.titleCard, now);
  }

  if (state.finished && state.winner) {
    const entries = buildRankedEntries(state.scores, state.winner.name);
    const winner = entries.find((e) => e.isWinner) ?? entries[0];
    if (winner) {
      rs.victoryScreen = createVictoryScreen({
        winner,
        rankings: entries,
        gameName: "Hangman",
        duration: 0,
        scoreSuffix: "pts",
      });
      showVictoryScreen(rs.victoryScreen, now, width, height);
      triggerShake(rs.shake, 0.5, now);
    }
  }
}

function layout(width: number, height: number, scale: number) {
  const margin = scaledSize(48, scale);
  const gap = scaledSize(24, scale);
  const railW = Math.min(width * 0.24, scaledSize(340, scale));
  const headerH = scaledSize(56, scale);
  const mainW = width - margin * 2 - railW - gap;
  return {
    margin,
    gap,
    mainW,
    top: margin + headerH,
    gallows: { x: margin, y: margin + headerH, width: mainW * 0.34, height: height - margin * 2 - headerH },
    word: {
      x: margin + mainW * 0.34 + gap,
      y: margin + headerH,
      width: mainW * 0.66 - gap,
      height: height - margin * 2 - headerH,
    },
    rail: { x: width - margin - railW, y: margin, width: railW, height: height - margin * 2 },
  };
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: HangmanScreenState,
  scale: number,
): void {
  const { margin } = layout(width, height, scale);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${scaledSize(28, scale)}px ${fonts.title.family}`;
  ctx.fillStyle = colors.text;
  ctx.fillText("HANGMAN", margin, margin + scaledSize(26, scale));
  const w = ctx.measureText("HANGMAN").width;

  const player = state.scores[state.currentPlayer];
  ctx.font = `600 ${scaledSize(18, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `Round ${state.round} of ${state.maxRounds}${player ? `  ·  ${player.name}` : ""}`,
    margin + w + scaledSize(18, scale),
    margin + scaledSize(25, scale),
  );
  void height;
}

function drawGallows(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: HangmanScreenState,
  scale: number,
): void {
  const { gallows } = layout(width, height, scale);
  const gallowsCard = {
    ...gallows,
    height: Math.min(gallows.height, scaledSize(420, scale)),
  };
  drawBentoCard(ctx, gallowsCard, { fill: "rgba(18,13,46,0.9)", stroke: colors.border });

  const cx = gallowsCard.x + gallowsCard.width * 0.52;
  const topY = gallowsCard.y + gallowsCard.height * 0.18;
  const baseY = gallowsCard.y + gallowsCard.height * 0.82;
  const beamW = gallowsCard.width * 0.34;
  const ink = "rgba(245,243,255,0.75)";
  const danger = colors.danger;
  const lw = Math.max(2, scaledSize(4, scale));

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";

  // Base + pole + beam + rope (always present).
  ctx.beginPath();
  ctx.moveTo(cx - beamW, baseY);
  ctx.lineTo(cx + beamW, baseY);
  ctx.moveTo(cx - beamW * 0.55, baseY);
  ctx.lineTo(cx - beamW * 0.55, topY);
  ctx.lineTo(cx + beamW * 0.55, topY);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,179,71,0.8)";
  ctx.beginPath();
  ctx.moveTo(cx + beamW * 0.55, topY);
  ctx.lineTo(cx + beamW * 0.55, topY + gallowsCard.height * 0.12);
  ctx.stroke();

  // Body parts appear with wrong guesses.
  const partColor = state.wrongGuesses >= state.maxWrong ? danger : ink;
  ctx.strokeStyle = partColor;
  ctx.fillStyle = partColor;
  const headY = topY + gallowsCard.height * 0.2;
  const headR = gallowsCard.height * 0.075;
  const neckY = headY + headR;
  const hipY = neckY + gallowsCard.height * 0.16;

  if (state.wrongGuesses >= 1) {
    ctx.beginPath();
    ctx.arc(cx + beamW * 0.55, headY, headR, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (state.wrongGuesses >= 2) {
    ctx.beginPath();
    ctx.moveTo(cx + beamW * 0.55, neckY);
    ctx.lineTo(cx + beamW * 0.55, hipY);
    ctx.stroke();
  }
  if (state.wrongGuesses >= 3) {
    ctx.beginPath();
    ctx.moveTo(cx + beamW * 0.55, neckY + gallowsCard.height * 0.04);
    ctx.lineTo(cx + beamW * 0.55 - gallowsCard.width * 0.1, neckY + gallowsCard.height * 0.1);
    ctx.stroke();
  }
  if (state.wrongGuesses >= 4) {
    ctx.beginPath();
    ctx.moveTo(cx + beamW * 0.55, neckY + gallowsCard.height * 0.04);
    ctx.lineTo(cx + beamW * 0.55 + gallowsCard.width * 0.1, neckY + gallowsCard.height * 0.1);
    ctx.stroke();
  }
  if (state.wrongGuesses >= 5) {
    ctx.beginPath();
    ctx.moveTo(cx + beamW * 0.55, hipY);
    ctx.lineTo(cx + beamW * 0.55 - gallowsCard.width * 0.1, hipY + gallowsCard.height * 0.13);
    ctx.stroke();
  }
  if (state.wrongGuesses >= 6) {
    ctx.beginPath();
    ctx.moveTo(cx + beamW * 0.55, hipY);
    ctx.lineTo(cx + beamW * 0.55 + gallowsCard.width * 0.1, hipY + gallowsCard.height * 0.13);
    ctx.stroke();

    // Dead eyes.
    ctx.fillStyle = danger;
    ctx.beginPath();
    ctx.arc(cx + beamW * 0.55 - headR * 0.35, headY - headR * 0.1, Math.max(1.5, headR * 0.14), 0, Math.PI * 2);
    ctx.arc(cx + beamW * 0.55 + headR * 0.35, headY - headR * 0.1, Math.max(1.5, headR * 0.14), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Wrong count.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${scaledSize(24, scale)}px ${fonts.display.family}`;
  ctx.fillStyle = state.wrongGuesses >= state.maxWrong ? danger : colors.text;
  ctx.fillText(`${state.wrongGuesses} / ${state.maxWrong}`, gallowsCard.x + gallowsCard.width / 2, gallowsCard.y + gallowsCard.height - scaledSize(32, scale));
  ctx.font = `500 ${scaledSize(15, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText("WRONG GUESSES", gallowsCard.x + gallowsCard.width / 2, gallowsCard.y + gallowsCard.height - scaledSize(12, scale));
}

function drawWord(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: HangmanScreenState,
  scale: number,
  now: number,
): void {
  const { word } = layout(width, height, scale);
  drawBentoCard(ctx, word, { fill: "rgba(18,13,46,0.9)", stroke: colors.border });

  const revealed = state.phase !== "playing";
  const letters = revealed ? state.word.split("") : state.masked.split("");
  const count = Math.max(1, letters.length);

  const availableW = word.width - scaledSize(48, scale);
  const slotW = Math.min(scaledSize(64, scale), availableW / count);
  const gap = Math.min(scaledSize(8, scale), slotW * 0.12);
  const slotH = slotW * 1.35;
  const totalW = count * slotW + (count - 1) * gap;
  const startX = word.x + (word.width - totalW) / 2;
  const startY = word.y + word.height * 0.42 - slotH / 2;

  const pulse = 0.5 + 0.5 * Math.sin(now * 0.005);
  letters.forEach((letter, i) => {
    const x = startX + i * (slotW + gap);
    const solvedLetter = letter !== "_";
    drawRoundRect(
      ctx,
      x,
      startY,
      slotW,
      slotH,
      scaledSize(8, scale),
      solvedLetter ? "rgba(61,255,162,0.10)" : "rgba(18,13,46,0.9)",
      solvedLetter ? "rgba(61,255,162,0.55)" : "rgba(255,255,255,0.12)",
      solvedLetter ? Math.max(1, scaledSize(2, scale)) : 1,
    );

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(scaledSize(14, scale), slotW * 0.52)}px ${fonts.display.family}`;
    ctx.fillStyle = solvedLetter ? colors.success : "rgba(162,155,207,0.55)";

    if (solvedLetter) {
      ctx.fillText(letter, x + slotW / 2, startY + slotH / 2 + 2);
    } else {
      // Underscore.
      ctx.fillRect(x + slotW * 0.22, startY + slotH * 0.7, slotW * 0.56, Math.max(2, slotH * 0.03));
    }
  });

  // Round-end banner.
  if (state.phase === "round-end") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const bannerY = startY + slotH + scaledSize(26, scale);
    ctx.globalAlpha = 0.5 + 0.5 * pulse;
    ctx.font = `700 ${scaledSize(20, scale)}px ${fonts.title.family}`;
    ctx.fillStyle = state.masked.includes("_") ? colors.danger : colors.success;
    ctx.fillText(
      state.masked.includes("_") ? "OUT OF GUESSES" : "WORD SOLVED",
      word.x + word.width / 2,
      bannerY,
    );
    ctx.globalAlpha = 1;
  }

  // Hint line.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${scaledSize(16, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(
    `${letters.length} letters  ·  ${state.guessed.filter((g) => state.word.includes(g)).length} correct`,
    word.x + word.width / 2,
    startY + slotH + scaledSize(58, scale),
  );
}

function drawAlphabet(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: HangmanScreenState,
  scale: number,
): void {
  const { word } = layout(width, height, scale);
  const y = word.y + word.height - scaledSize(64, scale);
  const cols = 13;
  const gap = scaledSize(5, scale);
  const cellW = (word.width - gap * (cols - 1)) / cols;
  const cellH = scaledSize(26, scale);
  const guessed = new Set(state.guessed);

  ALPHABET.forEach((letter, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = word.x + col * (cellW + gap);
    const cy = y + row * (cellH + gap);
    const isGuessed = guessed.has(letter);
    const isCorrect = isGuessed && state.word.includes(letter);

    drawRoundRect(
      ctx,
      x,
      cy,
      cellW,
      cellH,
      scaledSize(5, scale),
      isGuessed ? (isCorrect ? "rgba(61,255,162,0.14)" : "rgba(255,77,109,0.14)") : "rgba(255,255,255,0.035)",
      isGuessed ? (isCorrect ? "rgba(61,255,162,0.5)" : "rgba(255,77,109,0.5)") : "rgba(255,255,255,0.07)",
      1,
    );

    ctx.font = `700 ${Math.max(scaledSize(10, scale), cellW * 0.42)}px ${fonts.display.family}`;
    ctx.fillStyle = isGuessed ? (isCorrect ? colors.success : colors.danger) : colors.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(letter, x + cellW / 2, cy + cellH / 2 + 1);
  });
}

function drawRail(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: HangmanScreenState,
  scale: number,
): void {
  const { rail } = layout(width, height, scale);
  const n = Math.max(1, state.scores.length);
  const listH = Math.min(rail.height, scaledSize(80, scale) + n * scaledSize(72, scale));
  const rect = { ...rail, height: listH };
  drawBentoCard(ctx, rect, { glow: colors.magenta });

  const entries = state.scores.map((s, i) => ({
    name: s.name,
    score: s.score,
    playerIndex: i,
    isCurrent: i === state.currentPlayer && state.phase === "playing",
    isWinner: state.finished && state.winner?.name === s.name,
    animatedScore: s.score,
  }));
  drawScoreboard(ctx, rect, entries, { title: "SCORES", scale });

  // Round pips.
  const pipY = rect.y + rect.height + scaledSize(18, scale);
  for (let i = 0; i < state.maxRounds; i++) {
    const px = rail.x + scaledSize(6, scale) + i * scaledSize(16, scale);
    ctx.fillStyle = i < state.round - 1 ? colors.magenta : i === state.round - 1 ? colors.cyan : "rgba(245,243,255,0.16)";
    ctx.beginPath();
    ctx.arc(px, pipY, scaledSize(3.5, scale), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `600 ${scaledSize(11, scale)}px ${fonts.body.family}`;
  ctx.fillStyle = colors.textMuted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(`Round ${clamp(state.round, 1, state.maxRounds)}/${state.maxRounds}`, rail.x + scaledSize(6 + state.maxRounds * 16, scale), pipY);
}
