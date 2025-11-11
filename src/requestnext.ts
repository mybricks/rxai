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

interface ExtendParams {
  aiRole?: Tool["aiRole"];
}

class ApiRequestClient {
  async requestAsStream(
    messages: ChatMessages,
    emits: Emits,
    extendParams: ExtendParams,
  ): Promise<RequestResult> {
    return new Promise((resolve) => {
      console.log("[extendParams]", extendParams);
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

      requestAsStream({
        messages,
        emits: emitsProxy,
        extendParams: transfromExtendParams(extendParams),
      });
    });
  }
}

const requestAsStream = (params: {
  messages: ChatMessages;
  emits: Emits;
  extendParams: Record<string, unknown>;
}) => {
  const { messages, emits, extendParams } = params;
  const { cancel, write, complete, error } = emits;

  try {
    const controller = new AbortController();
    fetch("http://ai.mybricks.world/stream-test", {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages,
        ...extendParams,
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

const transfromExtendParams = (extendParams: ExtendParams) => {
  const { aiRole } = extendParams;
  let model = "deepseek-chat";
  let role = "default";

  if (!aiRole) {
    return {
      model,
      role,
    };
  }

  switch (true) {
    case ["image"].includes(aiRole): {
      model = "anthropic/claude-sonnet-4";
      role = "image";
      break;
    }
    case ["architect"].includes(aiRole): {
      model = "google/gemini-2.5-pro-preview";
      role = "architect";
      break;
    }
    case ["expert"].includes(aiRole): {
      model = "anthropic/claude-sonnet-4";
      role = "expert";
      break;
    }
    default: {
      role = "default";
      break;
    }
  }

  return {
    model,
    role,
  };
};

export { ApiRequestClient };
