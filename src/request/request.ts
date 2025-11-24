interface RequestAsStreamParams {
  messages: ChatMessages;
  aiRole?: AiRole;
  emits: Emits;
}

interface RequestOptions {
  requestAsStream: (params: RequestAsStreamParams) => void;
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
    | { type: "error"; content: Error }
    | { type: "cancel"; content: string }
  > {
    return new Promise((resolve) => {
      const { messages, emits, aiRole } = params;
      let content = "";
      const emitsProxy: Emits = {
        write(chunk) {
          emits.write(chunk.replace(/^M:/, ""));
          content += chunk;
        },
        complete() {
          emits.complete(content.replace(/^M:/, ""));
          resolve({
            type: "complete",
            content: content.replace(/^M:/, ""),
          });
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

      this.options.requestAsStream({
        messages,
        emits: emitsProxy,
        aiRole,
      });

      // import("./preset/cdzd").then((module) => {
      //   module.requestAsStream({
      //     messages,
      //     emits: emitsProxy,
      //     aiRole,
      //   });
      // });
    });
  }
}

export { Request, RequestOptions };
