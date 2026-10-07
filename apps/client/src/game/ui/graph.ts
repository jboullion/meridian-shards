// The BlakGraph bar control's maths (clientd3d/graphctl.c), kept free of React for tests.

/** graphctl.c GRAPH_SLIDER_HEIGHT and GRAPH_SIDE_BORDER: the slider triangle under input bars */
export const GRAPH_SLIDER_HEIGHT = 6;
export const GRAPH_SIDE_BORDER = GRAPH_SLIDER_HEIGHT / 2;

/** graphctl.c GraphCtlPaint: how far along the bar the value reaches, 0..1, clamped. */
export function graphFraction(value: number, min: number, max: number): number {
  if (min === max) return 1;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/**
 * graphctl.c GraphCtlMoveBar: the value under a click at `x`, measured from the control's
 * left edge. `width` is the control's whole width; a slider control keeps its side borders.
 */
export function graphValueAt(x: number, width: number, min: number, max: number, slider: boolean): number {
  const left = slider ? GRAPH_SIDE_BORDER : 0;
  const right = width - (slider ? GRAPH_SIDE_BORDER : 0);
  let v: number;
  if (x <= left + 1) v = min;
  else if (x >= right - 1) v = max;
  else v = min + Math.trunc(((x - left - 1) * (max - min)) / (right - left - 2));
  return Math.max(Math.min(v, max), min);
}
