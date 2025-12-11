import { RxaiError, RxaiErrorMessage, normalizeErrorMessage } from "./base";

interface RetryMessage {
  displayContent: string;
  llmContent: string;
}

class RetryError extends RxaiError {
  constructor(error: RetryMessage) {
    super({
      error,
      type: "retry",
    });
  }
}

export { RetryError };
