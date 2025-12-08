import { RxaiError, RxaiErrorMessage, normalizeErrorMessage } from "./base";

class RequestError extends RxaiError {
  constructor(error: string | RxaiErrorMessage) {
    super({
      error: normalizeErrorMessage(error),
      type: "request",
    });
  }
}

export { RequestError };
