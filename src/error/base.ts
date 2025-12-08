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

const normalizeErrorMessage = (
  error: string | RxaiErrorOptions["error"],
): RxaiErrorOptions["error"] => {
  if (typeof error === "string") {
    return {
      displayContent: error,
      llmContent: error,
    };
  }

  return error;
};

export { RxaiError, normalizeErrorMessage, RxaiErrorMessage };
