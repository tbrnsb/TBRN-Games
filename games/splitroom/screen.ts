import { renderPaperBoard } from "../../client/screen/kit/paperBoard.ts";

/** This renderer draws its own score rail; the platform ticker stays off. */
export const showsScores = true;

export function render(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: unknown,
): void {
  renderPaperBoard(ctx, width, height, state, {
    title: 'Split the Room',
    mode: 'text',
    heroKeys: ['scenario', 'prompt'],
    optionMode: false,
  });
}
