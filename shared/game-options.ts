/**
 * Shared option parsing for game plugin `onStart`.
 *
 * A preset Rumble passes `rounds` (plus `rumble` and `mode`) so the started
 * game runs the shorter Rumble length from the catalog. Games keep their
 * standalone behaviour when the option is absent, so this returns `undefined`
 * instead of a fallback and each game applies its own default.
 */

/** The explicit round count in `options.rounds`, or undefined when absent/invalid. */
export function roundsOption(options: Record<string, unknown> | undefined): number | undefined {
  const raw = options?.rounds;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const rounds = Math.floor(raw);
  return rounds >= 1 ? rounds : undefined;
}
