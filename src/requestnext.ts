interface Request {
  requestAsStream: (messages: ChatMessages, emits: Emits) => void;
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
  async requestAsStream(
    messages: ChatMessages,
    emits: Emits,
  ): Promise<RequestResult> {
    return new Promise((resolve) => {
      let content = "";
      const emitsProxy: Emits = {
        write(chunk) {
          emits.write(chunk);
          content += chunk;
        },
        complete() {
          emits.complete(content);
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

      requestAsStream({ messages, emits: emitsProxy });
    });
  }
}

const requestAsStream = (params: { messages: ChatMessages; emits: Emits }) => {
  const { messages, emits } = params;
  const { cancel, write, complete, error } = emits;

  try {
    const model = `anthropic/claude-sonnet-4`;

    const controller = new AbortController();
    fetch("http://ai.mybricks.world/stream-test", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        model,
      }),
    }).then(async (response) => {
      cancel(() => {
        //注册回调
        controller.abort(); //取消请求
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        write(chunk);
      }

      complete("");
    });
  } catch (ex) {
    error(ex as any);
  }
};

export { ApiRequestClient };
