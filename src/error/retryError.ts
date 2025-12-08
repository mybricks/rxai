import { RxaiError, RxaiErrorMessage, normalizeErrorMessage } from "./base";

class RetryError extends RxaiError {
  constructor(error: string | RxaiErrorMessage) {
    super({
      error: normalizeErrorMessage(error),
      type: "retry",
    });
  }
}

export { RetryError };
