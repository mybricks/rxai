import { RequestError } from "../error/requestError";

interface RequestAsStreamParams {
  messages: ChatMessages;
  aiRole?: AiRole;
  emits: Emits;
  enableLog?: boolean;
}

interface RequestOptions {
  requestAsStream: (params: RequestAsStreamParams) => void | Promise<unknown>;
}

class Request {
  private options: RequestOptions;
  constructor(options: RequestOptions) {
    this.options = options;
  }

  async requestAsStream(
    params: RequestAsStreamParams,
  ): Promise<
    | { type: "complete"; content: string }
    | { type: "error"; content: RequestError }
    | { type: "cancel"; content: string }
  > {
    return new Promise((resolve) => {
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
          emits.error(error);
          resolve({
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

      // if (aiRole === "expert" && APP_ENV === "development") {
      //   import("./preset/cdzd").then((module) => {
      //     (async () => {
      //       try {
      //         await module.requestAsStream({
      //           messages,
      //           emits: emitsProxy,
      //           aiRole,
      //         });
      //       } catch (error) {
      //         resolve({
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
          resolve({
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
      //       resolve({
      //         type: "error",
      //         content: normalizeToolError(error, "接口调用错误"),
      //       });
      //     }
      //   })();
      // });
    });
  }
}

export { Request, RequestOptions };
