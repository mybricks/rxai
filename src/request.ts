import { Tool } from "./tool/base";

interface Request {
  requestAsStream: (
    messages: ChatMessages,
    emits: Emits,
    extendParams: any,
  ) => void;
  getExtendParams?: (params: { messages: ChatMessages; tool?: Tool }) => any;
}

interface RequestCompleteResult {
  type: "complete";
  content: string;
}

interface RequestErrorResult {
  type: "error";
  content: Error;
}

interface RequestCancelResult {
  type: "cancel";
  content: string;
}

type RequestResult =
  | RequestCompleteResult
  | RequestErrorResult
  | RequestCancelResult;

class ApiRequestClient {
  private request: Request;

  constructor(request: Request) {
    this.request = request;
  }

  async requestAsStream(
    messages: ChatMessages,
    emits: Emits,
    extendParams: any,
  ): Promise<RequestResult> {
    return new Promise((resolve) => {
      let content = "";
      const emitsProxy: Emits = {
        write(chunk) {
          emits.write(chunk);
          content += chunk;
        },
        complete() {
          emits.complete();
          resolve({
            type: "complete",
            content,
          });
          console.log("[content]", content);
        },
        error(ex) {
          emits.error(ex);
          resolve({
            type: "error",
            content: ex,
          });
        },
        cancel(fn) {
          emits.cancel(() => {
            resolve({
              type: "cancel",
              content,
            });
            fn();
          });
        },
      };

      this.request.requestAsStream(messages, emitsProxy, extendParams);
    });
  }

  getExtendParams(
    params: Parameters<NonNullable<Request["getExtendParams"]>>[0],
  ) {
    return this.request.getExtendParams?.(params);
  }
}

export { Request, ApiRequestClient };
