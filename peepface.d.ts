export type FaceState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'searching'
  | 'streaming'
  | 'working'
  | 'waiting'
  | 'blocked'
  | 'finished'
  | 'failed'
  | 'sleeping'
  | 'waking';

export interface FaceOptions {
  /** 初始状态，默认 'idle' */
  state?: FaceState;
  /** 显示尺寸（px），默认 84 */
  size?: number;
  /** 深色主题：白脸黑眼。默认 false */
  dark?: boolean;
  /** 眼睛跟随鼠标，默认 true */
  follow?: boolean;
}

export interface Face {
  setState(state: FaceState): void;
  getState(): FaceState;
  blink(): void;
  destroy(): void;
  readonly el: HTMLElement;
}

export function createFace(container: Element, options?: FaceOptions): Face;
export const STATES: FaceState[];
export const VERSION: string;

declare const peepface: {
  createFace: typeof createFace;
  STATES: typeof STATES;
  VERSION: typeof VERSION;
};
export default peepface;
