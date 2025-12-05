import { RxaiError } from "./base";

class RetryError extends RxaiError<string> {
  constructor(error: unknown) {
    super({
      error: "rxai_retry",
      type: "retry",
    });
  }
}

export { RetryError };
