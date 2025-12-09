import { RxaiError, normalizeErrorMessage } from "./base";

class RequestError extends RxaiError {
  constructor(error: unknown) {
    super({
      error: normalizeErrorMessage(error),
      type: "request",
    });
  }
}

export { RequestError };
