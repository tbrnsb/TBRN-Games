/**
 * Host lobby stage geometry.
 *
 * The lobby is authored at a fixed 1280×666 stage (16:9 area below the topbar)
 * and scaled to fit; the same helper is used by the client and by tests.
 */

export const LOBBY_STAGE = { width: 1280, height: 666 } as const;

export function stageScale(
  containerWidth: number,
  containerHeight: number,
  design: { width: number; height: number } = LOBBY_STAGE,
): number {
  if (containerWidth < 2 || containerHeight < 2) return 1;
  return Math.min(containerWidth / design.width, containerHeight / design.height);
}
