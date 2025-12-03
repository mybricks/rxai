import { RxaiError } from "./base";

class RequestError extends RxaiError<string> {
  constructor(error: string) {
    super({
      error,
      type: "request",
    });
  }
}

export { RequestError };
