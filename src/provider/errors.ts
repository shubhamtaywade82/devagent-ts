export class AgentRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: string = "AGENT_RUNTIME_ERROR",
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class TransportFailure extends AgentRuntimeError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number | null,
    cause?: unknown,
  ) {
    super(message, "TRANSPORT_FAILURE", cause);
  }
}

export class RateLimitError extends TransportFailure {
  constructor(message: string, retryAfterMs?: number | null, cause?: unknown) {
    super(message, retryAfterMs, cause);
  }
}

export class TimeoutError extends TransportFailure {
  constructor(message: string, cause?: unknown) {
    super(message, null, cause);
  }
}

export class ProviderError extends AgentRuntimeError {
  constructor(message: string, cause?: unknown) {
    super(message, "PROVIDER_ERROR", cause);
  }
}

export class InferenceQualityError extends AgentRuntimeError {
  constructor(
    message: string,
    public readonly violations: string[] = [],
    public readonly rawOutput?: string,
  ) {
    super(message, "INFERENCE_QUALITY_ERROR");
  }
}

export class ToolFailure extends AgentRuntimeError {
  constructor(
    message: string,
    public readonly category: "validation" | "execution" | "timeout" | "denied" | "unknown_tool",
  ) {
    super(message, "TOOL_FAILURE");
  }
}

export class BudgetExhaustedError extends AgentRuntimeError {
  constructor(
    public readonly dimension: "steps" | "wallclock" | "tokens" | "intents" | "cost" | "calls",
    public readonly consumed: number,
    public readonly limit: number,
  ) {
    super(`Budget exhausted: ${dimension} (${consumed}/${limit})`, "BUDGET_EXHAUSTED");
  }
}

export class ConcurrencyDeniedError extends AgentRuntimeError {
  constructor(message: string, cause?: unknown) {
    super(message, "CONCURRENCY_DENIED", cause);
  }
}
