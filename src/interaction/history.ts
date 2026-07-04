/**
 * Prompt history: deduplicated, navigable with Up/Down, preserving the
 * draft the user was typing before they started browsing history.
 */

export class HistoryManager {
  private entries: string[] = [];
  /** null = not browsing; otherwise index into entries (from the end). */
  private cursor: number | null = null;
  private draft = "";

  constructor(
    initial: string[] = [],
    private readonly max = 200,
  ) {
    for (const entry of initial) this.add(entry);
  }

  all(): string[] {
    return [...this.entries];
  }

  add(entry: string): void {
    const trimmed = entry.trim();
    if (!trimmed) return;
    this.entries = this.entries.filter((e) => e !== trimmed).concat(trimmed);
    if (this.entries.length > this.max) this.entries = this.entries.slice(this.entries.length - this.max);
    this.cursor = null;
    this.draft = "";
  }

  /** Move back in history; returns the text the prompt should show. */
  up(current: string): string {
    if (this.entries.length === 0) return current;
    if (this.cursor === null) {
      this.draft = current;
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor -= 1;
    }
    return this.entries[this.cursor];
  }

  /** Move forward in history; past the newest entry restores the draft. */
  down(current: string): string {
    if (this.cursor === null) return current;
    if (this.cursor < this.entries.length - 1) {
      this.cursor += 1;
      return this.entries[this.cursor];
    }
    this.cursor = null;
    return this.draft;
  }

  /** Reset browsing (e.g. when the user edits the text). */
  stopBrowsing(): void {
    this.cursor = null;
  }

  /** Fuzzy-ish reverse search: newest entry containing every term. */
  search(query: string): string | null {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i].toLowerCase();
      if (terms.every((t) => entry.includes(t))) return this.entries[i];
    }
    return null;
  }
}
