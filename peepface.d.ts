export type FaceState =
  | 'idle' | 'listening' | 'thinking' | 'searching' | 'streaming' | 'working'
  | 'waiting' | 'blocked' | 'finished' | 'failed' | 'sleeping' | 'waking'
  | 'spawning' | 'reading' | 'coding' | 'running' | 'computing' | 'controlling'
  | 'orbit' | 'progress' | 'sending' | 'writing';

export interface Facts {
  running?: boolean;
  composing?: boolean;
  activity?: { kind?: string; tool?: string; detail?: string; target?: string; callId?: string } | null;
  awaiting?: { reason: string; since?: number } | null;
  settlement?: { outcome: 'success' | 'error'; at: number } | null;
}

export interface FaceOptions {
  id?: string;
  state?: FaceState | string;
  size?: number;
  shape?: string;
  color?: string;
  spot?: string;
  followPointer?: boolean;
  /** 静态模式：渲染一帧就停（用于缩略图） */
  static?: boolean;
}

export interface Face {
  state(name: string): Face;
  sync(facts: Facts): Face;
  shape(name: string): Face;
  color(value: string): Face;
  expression(name: string | null): Face;
  look(x: number, y: number): Face;
  gaze(v: unknown): Face;
  blink(): Face;
  restart(): Face;
  play(flag?: boolean): Face;
  poke(kind: string): Face;
  destroy(): void;
  readonly id: string;
  readonly engine: unknown;
}

export declare function createFace(host: HTMLElement | string, options?: FaceOptions): Face;
export declare function resolveFacts(facts: Facts | null, now?: number): string;
export declare function defineShape(name: string, spec: {
  path?: string;
  silhouette?: unknown;
  layout?: { width?: number; height?: number; gap?: number; shiftY?: number };
  size?: number;
  seat?: unknown;
  tolerance?: number;
}): { name: string; layout: Record<string, number> };
export declare function shapes(): string[];
export declare function shapeFromId(id: string): string;
export declare function colorFromId(id: string): string;

export declare const SHAPES: string[];
export declare const SHAPE_ALIAS: Record<string, string>;
export declare const PALETTE: { id: string; label: string; value: string }[];
export declare const STATE: Record<string, FaceState>;
export declare const STATE_ALL: FaceState[];
export declare const STATE_HELP: Record<string, string>;
export declare function resolveColor(input?: string, fallback?: string): string;
