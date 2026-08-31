// Infers Ollama Cloud session/weekly quota pressure from observed 429s.
//
// Ollama Cloud's account dashboard reports exact session/weekly usage
// percentages, but that's a web-only view — there's no public API for it, so
// the cloud tier's actual quota state can't be read directly. What Router
// *can* observe is RateLimitError: Provider.chat only throws it after the
// SDK's own key-failover has exhausted every configured cloud key (see
// mapSdkError in provider.ts), which is the same "cloud is out of budget
// right now" signal the dashboard's "Session usage: Exhausted" reflects.
//
// This tracks that signal over two windows so Router can skip a cloud
// candidate it already expects to fail (saving a doomed round-trip) rather
// than discovering it live on every single turn:
//   - session cooldown: a short, backing-off "cloud is rate limited right
//     now" window, cleared by the next cloud success.
//   - weekly pressure: a rolling 7-day count of rate-limit hits, used to
//     flag sustained pressure (repeated exhaustion, not one blip).
export interface UsageManagerOptions {
  /** Initial cooldown applied on the first rate-limit hit. Default 10 min,
   * matching the ~9 min session reset observed on Ollama's Free tier. */
  initialCooldownMs?: number;
  /** Cap for the cooldown after repeated hits. Default 1 hour. */
  maxCooldownMs?: number;
  /** Rolling window for weekly pressure tracking. Default 7 days. */
  weeklyWindowMs?: number;
  /** Rate-limit hits within the weekly window at/above which
   * `shouldConserve()` reports true. Default 5. */
  weeklyConserveThreshold?: number;
}

export interface UsageStatus {
  coolingDown: boolean;
  cooldownRemainingMs: number;
  weeklyHits: number;
  conserve: boolean;
}

const DEFAULT_INITIAL_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_MAX_COOLDOWN_MS = 60 * 60_000;
const DEFAULT_WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_WEEKLY_CONSERVE_THRESHOLD = 5;

export class UsageManager {
  private readonly initialCooldownMs: number;
  private readonly maxCooldownMs: number;
  private readonly weeklyWindowMs: number;
  private readonly weeklyConserveThreshold: number;

  private cooldownUntil = 0;
  /** Doubles on each hit while still cooling down; reset on the next success. */
  private nextCooldownMs: number;
  private weeklyHitTimestamps: number[] = [];

  constructor(opts: UsageManagerOptions = {}) {
    this.initialCooldownMs = opts.initialCooldownMs ?? DEFAULT_INITIAL_COOLDOWN_MS;
    this.maxCooldownMs = opts.maxCooldownMs ?? DEFAULT_MAX_COOLDOWN_MS;
    this.weeklyWindowMs = opts.weeklyWindowMs ?? DEFAULT_WEEKLY_WINDOW_MS;
    this.weeklyConserveThreshold = opts.weeklyConserveThreshold ?? DEFAULT_WEEKLY_CONSERVE_THRESHOLD;
    this.nextCooldownMs = this.initialCooldownMs;
  }

  /** Call when a cloud candidate throws RateLimitError (all keys exhausted). */
  recordCloudRateLimited(now: number = Date.now()): void {
    this.weeklyHitTimestamps.push(now);
    this.cooldownUntil = now + this.nextCooldownMs;
    // Back off further only while hits keep landing inside an active
    // cooldown — that's the "still exhausted" signal a weekly-limit brush
    // would produce; a hit long after cooldown had already lapsed restarts
    // from the initial window instead of carrying a stale multiplier.
    this.nextCooldownMs = Math.min(this.nextCooldownMs * 2, this.maxCooldownMs);
  }

  /** Call on any successful cloud response — proves the tier is reachable
   * again, so drop the cooldown and reset backoff. Weekly history is left
   * alone: a single success doesn't undo prior pressure. */
  recordCloudSuccess(now: number = Date.now()): void {
    this.cooldownUntil = 0;
    this.nextCooldownMs = this.initialCooldownMs;
    void now;
  }

  isCloudCoolingDown(now: number = Date.now()): boolean {
    return now < this.cooldownUntil;
  }

  /** True once weekly rate-limit hits reach the conserve threshold — a
   * signal for routing policy to prefer local more aggressively even
   * outside an active cooldown, not just a one-off blip. */
  shouldConserveCloud(now: number = Date.now()): boolean {
    return this.weeklyHitCount(now) >= this.weeklyConserveThreshold;
  }

  status(now: number = Date.now()): UsageStatus {
    return {
      coolingDown: this.isCloudCoolingDown(now),
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - now),
      weeklyHits: this.weeklyHitCount(now),
      conserve: this.shouldConserveCloud(now),
    };
  }

  private weeklyHitCount(now: number): number {
    const cutoff = now - this.weeklyWindowMs;
    this.weeklyHitTimestamps = this.weeklyHitTimestamps.filter((t) => t > cutoff);
    return this.weeklyHitTimestamps.length;
  }
}
