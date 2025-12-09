interface RxaiErrorMessage {
  displayContent: string;
  llmContent: string;
}

interface RxaiErrorOptions {
  error: RxaiErrorMessage;
  type: string;
}

class RxaiError {
  protected error: RxaiErrorOptions["error"];
  type: string;

  constructor(options: RxaiErrorOptions) {
    this.error = options.error;
    this.type = options.type;
  }

  get message() {
    return this.error;
  }
}

const DEFAULT_ERROR = "未知错误";

const normalizeErrorMessage = (error: any): RxaiErrorOptions["error"] => {
  const message = error?.message;

  let displayContent = DEFAULT_ERROR;
  let llmContent = DEFAULT_ERROR;

  if (typeof message === "string") {
    displayContent = llmContent = message;
  } else if (typeof message === "object") {
    if (message.displayContent) {
      displayContent = message.displayContent;
    }
    if (message.llmContent) {
      llmContent = message.llmContent;
    }
  }

  return {
    displayContent,
    llmContent,
  };
};

export { RxaiError, normalizeErrorMessage, RxaiErrorMessage };
