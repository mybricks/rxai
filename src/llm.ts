import OpenAI from "openai";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }[];
}

interface LLMConfig {
  apiKey: string;
  baseURL: string;
  // TODO: 传入各阶段模型？
  model: string;
}

interface LLMAskToolParams {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools: OpenAI.Chat.Completions.ChatCompletionTool[];
}

class LLM {
  private static instances: { [key: string]: LLM } = {};
  private openai: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.openai = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      dangerouslyAllowBrowser: true,
    });
    this.model = config.model;
  }

  public static getInstance(
    configName: string = "default",
    config: LLMConfig,
  ): LLM {
    if (!LLM.instances[configName]) {
      LLM.instances[configName] = new LLM(config);
    }
    return LLM.instances[configName];
  }

  /** Format messages for OpenAI if needed (accepts our ChatMessage format) */
  // private formatMessages(messages: ChatMessage[]) {
  //   // OpenAI library expects messages as {role, content[, name]} objects.
  //   return messages.map((msg) => {
  //     const { role, content, name, tool_calls, tool_call_id } = msg;

  //     if (role === "assistant" && tool_calls) {
  //       // Assistant messages with tool_calls: send with tool_calls property
  //       const formattedMsg = { role, tool_calls };
  //       // 确保每个消息都有 content 字段，即使它是空字符串
  //       formattedMsg.content = content ?? "";
  //       return formattedMsg;
  //     }
  //     if (role === "function") {
  //       // Function result message: include name and content
  //       return { role, name: name, content: content ?? "" };
  //     }
  //     if (role === "tool") {
  //       // Tool result message: include tool_call_id and content
  //       return { role, tool_call_id, content: content ?? "" };
  //     }
  //     // system or user or assistant (normal) messages
  //     return { role, content: content ?? "" };
  //   });
  // }

  async askTool(params: LLMAskToolParams): Promise<{
    content?: string;
    functionCall?: { name: string; arguments: string };
  }> {
    console.log("[params]", params);

    const stream = await this.openai.chat.completions.create({
      model: "gpt-5-mini",
      messages: params.messages,
      tools: params.tools,
      stream: true,
      tool_choice: "auto",
    });

    const toolCalls = [];

    let content = "";

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (!delta) {
        continue;
      }

      if (delta.content) {
        content += delta.content;
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const index = tc.index;
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: "",
              type: "function",
              function: { name: "", arguments: "" },
            };
          }
          const call = toolCalls[index];
          if (tc.id) {
            call.id += tc.id;
          }
          if (tc.function?.name) {
            // console.log("[call.function.name]", tc.function.name);
            call.function.name += tc.function.name;
          }
          if (tc.function?.arguments) {
            // console.log("[call.function.arguments]", tc.function.arguments);
            call.function.arguments += tc.function.arguments;
          }
        }
      }

      // if (chunk.choices[0]?.finish_reason === "tool_calls") {
      //   console.log("工具调用完成:", toolCalls);
      //   // 此时你可以解析 arguments 并执行函数
      // }
    }

    if (toolCalls.length) {
      return {
        functionCall: {
          name: toolCalls[0].function.name,
          arguments: toolCalls[0].function.arguments,
        },
      };
    } else {
      return {
        content,
      };
    }
  }
}

export { LLM, LLMConfig, ChatMessage };
