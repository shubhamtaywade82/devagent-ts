export type HookDecision = { allow: true; updatedPrompt?: string } | { allow: false; reason: string };

export type HookContext = {
  toolName: string;
  input: Record<string, unknown>;
};

export type PreToolUseHook = (ctx: HookContext) => HookDecision | Promise<HookDecision>;

export type PostToolUseHook = (
  ctx: HookContext & {
    result: string;
    isError: boolean;
  },
) => void | Promise<void>;

export type UserPromptSubmitHook = (prompt: string) => HookDecision | Promise<HookDecision>;

export class HookEngine {
  private preHooks: PreToolUseHook[] = [];
  private postHooks: PostToolUseHook[] = [];
  private promptHooks: UserPromptSubmitHook[] = [];

  onPreToolUse(hook: PreToolUseHook): void {
    this.preHooks.push(hook);
  }

  onPostToolUse(hook: PostToolUseHook): void {
    this.postHooks.push(hook);
  }

  onUserPromptSubmit(hook: UserPromptSubmitHook): void {
    this.promptHooks.push(hook);
  }

  async runPreToolUse(ctx: HookContext): Promise<HookDecision> {
    for (const hook of this.preHooks) {
      const decision = await hook(ctx);
      if (!decision.allow) return decision;
    }
    return { allow: true };
  }

  async runPostToolUse(ctx: HookContext & { result: string; isError: boolean }): Promise<void> {
    for (const hook of this.postHooks) {
      await hook(ctx);
    }
  }

  async runUserPromptSubmit(prompt: string): Promise<HookDecision> {
    let current = prompt;
    for (const hook of this.promptHooks) {
      const decision = await hook(current);
      if (!decision.allow) return decision;
      if (decision.updatedPrompt) current = decision.updatedPrompt;
    }
    return { allow: true, updatedPrompt: current };
  }
}
