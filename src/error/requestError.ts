import { RxaiError } from "./base";

class RequestError extends RxaiError<string> {
  constructor(error: string) {
    super(error);
  }

  get message() {
    return this.error;
  }
}

export { RequestError };
