import { renderPaperBoard } from "../../client/screen/kit/paperBoard.ts";

export function render(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: unknown,
): void {
  renderPaperBoard(ctx, width, height, state, {
    title: 'Slide Roulette',
    mode: 'slide',
    heroKeys: ['slide', 'topic'],
    optionMode: true,
  });
}
