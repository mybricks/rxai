import { RxaiError } from "./base";

class RequestError extends RxaiError<string> {
  constructor(error: unknown) {
    super({
      error: transformRequestErrorMessage(error),
      type: "request",
    });
  }
}

const transformRequestErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === "string") {
    return error;
  }
  return "接口调用错误";
};

export { RequestError };
