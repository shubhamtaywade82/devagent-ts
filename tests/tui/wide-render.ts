/**
 * ink-testing-library hardcodes its mock stdout's `columns` to 100
 * (node_modules/ink-testing-library/build/index.js), which Ink's own
 * renderer uses as a hard ceiling for content rows containing multiple
 * sibling bordered boxes — independent of any width prop passed down the
 * React tree. That's fine for every existing view (none exceed ~100 cols
 * of real content), but the Dashboard view requires >=130 cols to even
 * activate its 3-column layout (see DashboardView.MIN_WIDTH_FOR_DASHBOARD),
 * so testing it through ink-testing-library's `render()` silently clips
 * every wide test to a corrupted <=101-char render — never representative
 * of what a real terminal (whose `stdout.columns` always matches its own
 * rendering width) actually shows.
 *
 * This is a drop-in replacement for ink-testing-library's `render()` with
 * one difference: `columns` is configurable and real, not hardcoded.
 */

import { EventEmitter } from "node:events";
import { render as inkRender } from "ink";
import type { ReactElement } from "react";

class WideStdout extends EventEmitter {
  columns: number;
  frames: string[] = [];
  private _lastFrame?: string;
  constructor(columns: number) {
    super();
    this.columns = columns;
  }
  write = (frame: string): void => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };
  lastFrame = (): string | undefined => this._lastFrame;
}

class Stderr extends EventEmitter {
  frames: string[] = [];
  private _lastFrame?: string;
  write = (frame: string): void => {
    this.frames.push(frame);
    this._lastFrame = frame;
  };
  lastFrame = (): string | undefined => this._lastFrame;
}

class Stdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (data: string): void => {
    this.data = data;
    this.emit("readable");
    this.emit("data", data);
  };
  setEncoding(): void {}
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
  ref(): void {}
  unref(): void {}
  read = (): string | null => {
    const { data } = this;
    this.data = null;
    return data;
  };
}

export interface RenderWideResult {
  lastFrame: () => string | undefined;
  stdin: Stdin;
  unmount: () => void;
}

/** Same shape as ink-testing-library's render(), but stdout.columns genuinely reflects `columns` instead of a hardcoded 100. */
export function renderWide(tree: ReactElement, columns: number): RenderWideResult {
  const stdout = new WideStdout(columns);
  const stderr = new Stderr();
  const stdin = new Stdin();
  const instance = inkRender(tree, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stderr: stderr as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return {
    lastFrame: stdout.lastFrame,
    stdin,
    unmount: () => {
      instance.unmount();
      instance.cleanup();
    },
  };
}
