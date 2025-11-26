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

const normalizeToolError = (error: unknown, message: string = "错误") => {
  console.error("[Rxai - error]", error);
  if (error instanceof ToolError) {
    return error;
  } else if (error instanceof Error) {
    const message = error.message;
    return new ToolError({ displayContent: message, llmContent: message });
  } else {
    return new ToolError({
      displayContent: message,
      llmContent: message,
    });
  }
};

export { ToolError, normalizeToolMessage, normalizeToolError };
