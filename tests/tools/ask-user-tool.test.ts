import { AskUserTool, ClarificationRequester } from "../../src/tools/ask-user-tool.js";
import { ClarificationRequest, ClarificationResponse } from "../../src/runtime/types.js";

describe("AskUserTool", () => {
  it("validates input and returns error if question is empty", async () => {
    const mockRequester: ClarificationRequester = {
      requestClarification: jest.fn(),
    };
    const tool = new AskUserTool(mockRequester);
    const res = await tool.call({ question: "", options: ["a", "b"] });
    expect(res.error).toBe("Question cannot be empty");
    expect(mockRequester.requestClarification).not.toHaveBeenCalled();
  });

  it("validates input and returns error if less than 2 options provided", async () => {
    const mockRequester: ClarificationRequester = {
      requestClarification: jest.fn(),
    };
    const tool = new AskUserTool(mockRequester);
    const res = await tool.call({ question: "Which one?", options: ["only one"] });
    expect(res.error).toBe("At least 2 options are required");
    expect(mockRequester.requestClarification).not.toHaveBeenCalled();
  });

  it("delegates to requester and returns selected option label", async () => {
    const mockRequester: ClarificationRequester = {
      requestClarification: jest
        .fn()
        .mockImplementation(async (req: ClarificationRequest): Promise<ClarificationResponse> => {
          return { id: req.id, selectedId: "opt_2" };
        }),
    };
    const tool = new AskUserTool(mockRequester);
    const res = await tool.call({
      question: "Which database do you prefer?",
      options: ["PostgreSQL", "SQLite", "MySQL"],
    });

    expect(mockRequester.requestClarification).toHaveBeenCalledTimes(1);
    expect(res.selected).toBe("SQLite");
  });

  it("handles custom instructions response cleanly", async () => {
    const mockRequester: ClarificationRequester = {
      requestClarification: jest
        .fn()
        .mockImplementation(async (req: ClarificationRequest): Promise<ClarificationResponse> => {
          return { id: req.id, selectedId: "custom", customText: "Use DuckDB in-memory" };
        }),
    };
    const tool = new AskUserTool(mockRequester);
    const res = await tool.call({
      question: "Which database do you prefer?",
      options: ["PostgreSQL", "SQLite"],
    });

    expect(res.selected).toBe("custom");
    expect(res.customInstructions).toBe("Use DuckDB in-memory");
  });
});
