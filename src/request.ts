import { Tool } from "./tool/base";

interface Emits {
  write: (chunk: string) => void;
  complete: () => void;
  error: (e: Error) => void;
  cancel: (cb: () => void) => void;
}

interface RequestConfig {
  // 事件
  emits: Emits;
}

interface Request {
  requestAsStream: (
    messages: ChatMessages,
    emits: Emits,
    config: {
      aiRole?: string;
    },
  ) => void;
}

const DEFAULT_EMITS: Emits = {
  write() {},
  complete() {},
  error() {},
  cancel() {},
};

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
  ): Promise<RequestResult> {
    console.log("[发起请求]", messages);
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

      this.request.requestAsStream(messages, emitsProxy, { aiRole: "" });
    });
  }
}

export { Emits, Request, ApiRequestClient };

// import { Tool } from "./tool/base";

// interface Emits {
//   write: (chunk: string) => void;
//   complete: () => void;
//   error: (e: Error) => void;
//   cancel: (cb: () => void) => void;
// }

// interface RequestConfig {
//   // 事件
//   emits: Emits;
// }

// interface Request {
//   requestAsStream: (
//     messages: ChatMessages,
//     emits: Emits,
//     config: {
//       aiRole?: string;
//     },
//   ) => void;
// }

// const DEFAULT_EMITS: Emits = {
//   write() {},
//   complete() {},
//   error() {},
//   cancel() {},
// };

// interface RequestCompleteResult {
//   type: "complete";
//   content: string;
// }

// interface RequestErrorResult {
//   type: "error";
//   content: Error;
// }

// interface RequestCancelResult {
//   type: "cancel";
//   content: string;
// }

// type RequestResult =
//   | RequestCompleteResult
//   | RequestErrorResult
//   | RequestCancelResult;

// class ApiRequestClient {
//   private request: Request;
//   private requestConfig: RequestConfig = {
//     emits: DEFAULT_EMITS,
//   };

//   constructor(request: Request) {
//     this.request = request;
//   }

//   setRequestConfig(requestConfig: RequestConfig) {
//     this.requestConfig = requestConfig;
//   }

//   async requestAsStream(
//     messages: ChatMessages,
//     tool?: Tool,
//   ): Promise<RequestResult> {
//     console.log("[发起请求]", messages);
//     console.log("[调用工具]", tool);
//     return new Promise((resolve) => {
//       const { emits } = this.requestConfig;
//       let content = "";
//       tool?.streamStart();
//       const emitsProxy: Emits = {
//         write(chunk) {
//           emits.write(chunk);
//           content += chunk;
//           tool?.streaming(
//             { text: chunk },
//             {
//               read() {
//                 return "";
//               },
//               write() {},
//               error() {},
//             },
//           );
//         },
//         complete() {
//           emits.complete();
//           resolve({
//             type: "complete",
//             content,
//           });
//           tool?.streamEnd(
//             { text: content },
//             {
//               read() {
//                 return "";
//               },
//               write() {},
//               error() {},
//             },
//           );

//           console.log("[content]", content);
//         },
//         error(ex) {
//           emits.error(ex);
//           resolve({
//             type: "error",
//             content: ex,
//           });
//           tool?.streamError(ex, {
//             read() {
//               return "";
//             },
//             write() {},
//             error() {},
//           });
//         },
//         cancel(fn) {
//           emits.cancel(() => {
//             resolve({
//               type: "cancel",
//               content,
//             });
//             fn();
//             tool?.streamEnd(
//               { text: content },
//               {
//                 read() {
//                   return "";
//                 },
//                 write() {},
//                 error() {},
//               },
//             );
//           });
//         },
//       };

//       this.request.requestAsStream(messages, emitsProxy, { aiRole: "" });
//     });
//   }
// }

// export { Emits, Request, ApiRequestClient };
