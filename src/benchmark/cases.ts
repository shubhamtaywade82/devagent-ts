import { ChatResponse } from "../provider/provider.js";
import { BenchmarkCase } from "./types.js";

function parseContent(content: unknown): unknown {
  if (typeof content !== "string") return undefined;
  // Models sometimes wrap JSON in a ```json fence despite instructions not to.
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const raw = fenced ? fenced[1] : content;
  try {
    return JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
}

const WEATHER_TOOL = {
  type: "function" as const,
  function: {
    name: "get_weather",
    description: "Get the current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};

const TIME_TOOL = {
  type: "function" as const,
  function: {
    name: "get_time",
    description: "Get the current local time for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
  },
};

const SEARCH_TOOL = {
  type: "function" as const,
  function: {
    name: "search_web",
    description: "Search the web for a query",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
};

const ALARM_TOOL = {
  type: "function" as const,
  function: {
    name: "set_alarm",
    description: "Set an alarm",
    parameters: {
      type: "object",
      properties: {
        hour: { type: "number", description: "Hour in 24h format" },
        repeat: { type: "boolean", description: "Whether the alarm repeats daily" },
      },
      required: ["hour", "repeat"],
    },
  },
};

function firstToolCall(response: ChatResponse): { name: string; args: unknown } | undefined {
  const toolCalls = response.message?.tool_calls as Array<{ function: { name: string; arguments: unknown } }> | undefined;
  if (!toolCalls || toolCalls.length === 0) return undefined;
  const call = toolCalls[0];
  const args = typeof call.function.arguments === "string" ? tryParse(call.function.arguments) : call.function.arguments;
  return { name: call.function.name, args };
}

function lastNumberIn(text: string): number | undefined {
  const matches = text.match(/-?\d+(\.\d+)?/g);
  if (!matches || matches.length === 0) return undefined;
  return Number(matches[matches.length - 1]);
}

export const BUILTIN_CASES: BenchmarkCase[] = [
  {
    id: "json-validity",
    category: "output-format",
    description: "Responds with strictly valid, correctly-shaped JSON",
    messages: [
      {
        role: "user",
        content: 'Respond with ONLY a JSON object, no prose, no markdown fence: {"answer": <the number 2+2>}',
      },
    ],
    validate: (response) => {
      const parsed = parseContent(response.message?.content) as { answer?: unknown } | undefined;
      if (!parsed) return { pass: false, reason: "response was not valid JSON" };
      if (parsed.answer !== 4) return { pass: false, reason: `expected answer:4, got ${JSON.stringify(parsed.answer)}` };
      return { pass: true };
    },
  },
  {
    id: "tool-calling",
    category: "tool-calling",
    description: "Calls the offered tool instead of answering in prose",
    messages: [{ role: "user", content: "What's the weather in Paris? Use the get_weather tool to find out." }],
    tools: [WEATHER_TOOL],
    validate: (response) => {
      const call = firstToolCall(response);
      if (!call) return { pass: false, reason: "no tool call in response" };
      if (call.name !== "get_weather") return { pass: false, reason: `called ${call.name} instead of get_weather` };
      const city = (call.args as { city?: string } | undefined)?.city ?? "";
      if (!/paris/i.test(city)) return { pass: false, reason: `city argument was "${city}", expected "Paris"` };
      return { pass: true };
    },
  },
  {
    id: "tool-selection-among-distractors",
    category: "tool-calling",
    description: "Picks the correct tool when multiple plausible tools are offered",
    messages: [{ role: "user", content: "What time is it right now in Tokyo? Use the appropriate tool." }],
    tools: [WEATHER_TOOL, TIME_TOOL, SEARCH_TOOL],
    validate: (response) => {
      const call = firstToolCall(response);
      if (!call) return { pass: false, reason: "no tool call in response" };
      if (call.name !== "get_time") return { pass: false, reason: `called ${call.name} instead of get_time` };
      return { pass: true };
    },
  },
  {
    id: "tool-call-typed-arguments",
    category: "tool-calling",
    description: "Passes correctly-typed number/boolean arguments, not just strings",
    messages: [{ role: "user", content: "Set an alarm for 7 o'clock that repeats every day." }],
    tools: [ALARM_TOOL],
    validate: (response) => {
      const call = firstToolCall(response);
      if (!call) return { pass: false, reason: "no tool call in response" };
      if (call.name !== "set_alarm") return { pass: false, reason: `called ${call.name} instead of set_alarm` };
      const args = call.args as { hour?: unknown; repeat?: unknown } | undefined;
      if (Number(args?.hour) !== 7) return { pass: false, reason: `hour was ${JSON.stringify(args?.hour)}, expected 7` };
      const repeat = args?.repeat === true || args?.repeat === "true";
      if (!repeat) return { pass: false, reason: `repeat was ${JSON.stringify(args?.repeat)}, expected true` };
      return { pass: true };
    },
  },
  {
    id: "no-unnecessary-tool-call",
    category: "tool-calling",
    description: "Answers directly instead of reaching for an irrelevant tool",
    messages: [{ role: "user", content: "What is 9 times 6? Answer with just the number." }],
    tools: [WEATHER_TOOL],
    validate: (response) => {
      const toolCalls = response.message?.tool_calls;
      if (toolCalls && toolCalls.length > 0) return { pass: false, reason: "called a tool for a question answerable directly" };
      const content = response.message?.content ?? "";
      if (!/54/.test(content)) return { pass: false, reason: `expected "54" in response, got "${content}"` };
      return { pass: true };
    },
  },
  {
    id: "reasoning-multi-step-math",
    category: "reasoning",
    description: "Solves a word problem requiring more than one arithmetic step",
    messages: [
      {
        role: "user",
        content:
          "A store had 120 apples. It sold 35% of them in the morning and 20 more in the afternoon. " +
          "How many apples are left? Give just the final number as your last line.",
      },
    ],
    validate: (response) => {
      const content = response.message?.content ?? "";
      const value = lastNumberIn(content);
      if (value !== 58) return { pass: false, reason: `expected final answer 58, got ${value ?? "(no number found)"}` };
      return { pass: true };
    },
  },
  {
    id: "reasoning-logic-deduction",
    category: "reasoning",
    description: "Follows a short chain of comparisons to the correct conclusion",
    messages: [
      {
        role: "user",
        content: "Alice is taller than Bob. Bob is taller than Carol. Who is the shortest? Answer with just the name.",
      },
    ],
    validate: (response) => {
      const content = response.message?.content ?? "";
      if (!/carol/i.test(content)) return { pass: false, reason: `expected "Carol" in response, got "${content}"` };
      return { pass: true };
    },
  },
  {
    id: "thinking-shows-work",
    category: "thinking",
    description: "Reaches the correct answer on a problem that benefits from step-by-step reasoning",
    messages: [
      { role: "user", content: "Solve step by step: what is 17 times 23? Show your reasoning, then give the final answer." },
    ],
    validate: (response) => {
      const content = response.message?.content ?? "";
      const thinking = (response.message as { thinking?: string } | undefined)?.thinking;
      const value = lastNumberIn(content);
      if (value !== 391) return { pass: false, reason: `expected final answer 391, got ${value ?? "(no number found)"}` };
      return { pass: true, reason: thinking ? "model returned a separate thinking field" : "no separate thinking field returned" };
    },
  },
];

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
