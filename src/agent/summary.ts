import { BaseAgent, BaseAgentOptions } from "./base";
import { getSummaryPrompt } from "../prompt/summary";

interface SummaryAgentOptions extends BaseAgentOptions {
  tools: Tool[];
}

/** 总结，判断是否完成任务 */
abstract class SummaryAgent extends BaseAgent {
  protected summaryMessages: ChatMessages = [];

  constructor(options: SummaryAgentOptions) {
    super(options);
  }

  async summary({
    messages,
    userMessage,
  }: {
    messages: ChatMessages;
    userMessage: ChatMessages[number];
  }) {
    console.log("[开始总结分析]", messages);
    const response = await this.requestInstance.requestAsStream({
      messages: [
        ...messages,
        {
          role: "user",
          content: getSummaryPrompt(),
        },
      ],
      emits: {
        write: (chunk) => {},
        complete: (content) => {},
        error: (error) => {},
        cancel: (fn) => {},
      },
    });

    if (response.type === "complete") {
      const content = JSON.parse(response.content);

      console.log("[总结结果]", content);

      if (content.status === "completed") {
        const [filename, suffix] = content.filename.split(".");
        content.filename = `${filename}_${new Date().getTime()}.${suffix}`;

        this.summaryMessages = [
          userMessage,
          {
            role: "assistant",
            content:
              `用户需求已完成，已对当前需求或问答执行过程进行压缩，并写入本地文件，只透出文件名和摘要，当接下来的对话需要用到这一步的详细步骤信息或任何内容，请读取该文件，读取后会将上下文注入对话中` +
              `\n文件名：${content.filename}` +
              `\n摘要：${content.summary}`,
          },
        ];
      }

      return content;
    }
  }
}

export { SummaryAgent };
