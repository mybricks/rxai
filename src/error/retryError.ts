import { RxaiError } from "./base";

class RetryError extends RxaiError<string> {
  constructor(error: string) {
    super({
      error,
      type: "retry",
    });
  }
}

export { RetryError };
