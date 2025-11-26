interface ToolMessage {
  displayContent: string;
  llmContent: string;
}

class ToolError {
  private error: ToolMessage;

  constructor(error: ToolMessage) {
    this.error = error;
  }

  get message() {
    return this.error;
  }
}

const normalizeToolMessage = (message: string | ToolMessage): ToolMessage => {
  if (typeof message === "string") {
    return {
      displayContent: message,
      llmContent: message,
    };
  }

  return message;
};

export { ToolError, normalizeToolMessage };
