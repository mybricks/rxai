import { RxaiError } from "./base";

interface ToolMessage {
  displayContent: string;
  llmContent: string;
}

class ToolError extends RxaiError {
  constructor(error: ToolMessage) {
    super({
      error,
      type: "tool",
    });
  }
}

export { ToolError };
