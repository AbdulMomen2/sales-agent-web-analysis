export interface SinglePoint {
  x: number;
  y: number;
  pressure?: number;
  radius_x?: number;
  radius_y?: number;
}

export interface TargetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TimedPoint extends SinglePoint {
  t: number;
}
