// Flags when a (tool, args, error) signature repeats twice
// consecutively — the documented trigger for RE_PLAN over a straight
// retry ("model issues a tool-call with the exact same argument
// signature 2 times consecutively and receives the same error").
export class LoopDetector {
  private lastSignature: string | null = null;
  private lastError: string | null = null;
  private repeatCount = 0;

  record(toolName: string, args: Record<string, unknown>, error: string): boolean {
    const signature = `${toolName}:${JSON.stringify(this.sortKeys(args))}`;

    if (signature === this.lastSignature && error === this.lastError) {
      this.repeatCount += 1;
    } else {
      this.repeatCount = 1;
      this.lastSignature = signature;
      this.lastError = error;
    }

    return this.repeatCount >= 2;
  }

  reset(): void {
    this.lastSignature = null;
    this.lastError = null;
    this.repeatCount = 0;
  }

  private sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.keys(obj)
      .sort()
      .reduce((acc: Record<string, unknown>, key) => {
        acc[key] = obj[key];
        return acc;
      }, {});
  }
}
