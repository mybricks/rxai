import { RequestError } from "../error/requestError";
import { retry } from "../utils/retry";

interface RequestAsStreamParams {
  messages: ChatMessages;
  aiRole?: AiRole;
  emits: Emits;
  enableLog?: boolean;
}

interface RequestOptions {
  requestAsStream: (params: RequestAsStreamParams) => void | Promise<unknown>;
  /** 重试次数 */
  maxRetries?: number;
}

class Request {
  private options: Required<RequestOptions>;
  constructor(options: RequestOptions) {
    this.options = {
      maxRetries: 0,
      ...options,
    };
  }

  async requestAsStream(
    params: RequestAsStreamParams,
  ): Promise<
    | { type: "complete"; content: string }
    | { type: "error"; content: RequestError }
    | { type: "cancel"; content: string }
  > {
    const requestAsStream: () => ReturnType<
      Request["requestAsStream"]
    > = () => {
      return new Promise((resolve, reject) => {
        const { messages, emits, aiRole, enableLog } = params;
        let content = "";
        const emitsProxy: Emits = {
          write(chunk) {
            emits.write(chunk.replace(/^M:/, ""));
            content += chunk;
          },
          complete() {
            if (enableLog) {
              console.log("[Request - requestAsStream - complete]", content);
            }
            emits.complete(content.replace(/^M:/, ""));
            console.log("接口返回结果", content.replace(/^M:/, ""));
            resolve({
              type: "complete",
              content: content.replace(/^M:/, ""),
            });
          },
          error(error) {
            if (enableLog) {
              console.log("[Request - requestAsStream - error]", error);
            }
            reject({
              type: "error",
              content: new RequestError(error),
            });
          },
          cancel(cancel) {
            emits.cancel(() => {
              resolve({
                type: "cancel",
                content,
              });
              cancel();
            });
          },
        };

        // if ((aiRole === "expert" || aiRole === "architect") && APP_ENV === "development") {
        //   import("./preset/cdzd").then((module) => {
        //     (async () => {
        //       try {
        //         await module.requestAsStream({
        //           messages,
        //           emits: emitsProxy,
        //           aiRole,
        //         });
        //       } catch (error) {
        //         reject({
        //           type: "error",
        //           content: normalizeToolError(error, "接口调用错误"),
        //         });
        //       }
        //     })();
        //   });

        //   return;
        // }

        (async () => {
          try {
            await this.options.requestAsStream({
              messages,
              emits: emitsProxy,
              aiRole,
            });
          } catch (error) {
            reject({
              type: "error",
              content: new RequestError(error),
            });
          }
        })();

        // import("./preset/cdzd").then((module) => {
        //   (async () => {
        //     try {
        //       await module.requestAsStream({
        //         messages,
        //         emits: emitsProxy,
        //         aiRole,
        //       });
        //     } catch (error) {
        //       reject({
        //         type: "error",
        //         content: normalizeToolError(error, "接口调用错误"),
        //       });
        //     }
        //   })();
        // });
      });
    };

    return new Promise((resolve) => {
      retry<ReturnType<Request["requestAsStream"]>>(
        requestAsStream,
        this.options.maxRetries,
      )
        .then(resolve)
        .catch((error) => {
          params.emits.error(error);
          resolve(error);
        });
    });
  }

  get maxRetries() {
    return this.options.maxRetries;
  }
}

export { Request, RequestOptions };
