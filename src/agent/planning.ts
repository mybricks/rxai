import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  tools: Tool[];
  key: string;
  message: string;
  attachments?: Attachment[];
  historyMessages: ChatMessages;
  presetMessages: ChatMessages;
}

/**
 * 分析计划
 * 执行计划
 */
class PlanningAgent extends BaseAgent {
  planList: { name: string; done: boolean; pending: boolean }[] = [];
  planIndex: number = 0;
  private tools: Tool[];
  private emits: Emits;
  private key: string;
  private message: string;
  private attachments?: Attachment[];
  private historyMessages: ChatMessages;
  private presetMessages: ChatMessages;

  // TODO
  loading = true;

  constructor(options: PlanningAgentOptions) {
    super(options);
    this.tools = options.tools;
    this.emits = options.emits;
    this.key = options.key;
    this.message = options.message;
    this.attachments = options.attachments;
    this.historyMessages = options.historyMessages;
    this.presetMessages = options.presetMessages;
  }

  getMessages() {
    return this.messages;
  }

  async run() {
    const content = this.attachments?.length
      ? [
          {
            type: "text",
            text: this.message,
          },
          ...this.attachments
            .filter((attachement) => {
              return attachement.type === "image";
            })
            .map((attachement) => {
              return {
                type: "image_url",
                image_url: {
                  url: attachement.content,
                },
              };
            }),
        ]
      : this.message;

    this.messages.push({
      role: "user",
      content,
    });

    this.messagesCallback(this.messages);

    await this.getPlanList();
    await this.executePlanList();

    // 结束
    this.loading = false;
    this.loadingCallback(this.loading);
  }

  private async getPlanList() {
    const emitsProxy: Emits = {
      write: (chunk) => {
        this.emits.write(chunk);
        this.messageStreamCallBack(chunk);
      },
      complete: () => {},
      error: (error) => {
        this.emits.error(error);
      },
      cancel: (fn) => {
        this.emits.cancel(fn);
      },
    };
    const messages = [
      {
        role: "system",
        content: getSystemPrompt({
          title: this.system.title,
          tools: this.tools,
        }),
      },
      ...this.historyMessages,
      ...this.presetMessages,
      ...this.messages,
    ];
    const response = await this.requestInstance.requestAsStream({
      messages,
      emits: emitsProxy,
      aiRole: "plan",
    });

    if (response.type === "complete") {
      const match = response.content!.match(
        /file="planList\.json"[\s\S]*?(\[[\s\S]*?\])/,
      );

      if (match?.[1]) {
        // 正常返回计划列表，执行act
        // TODO: 解析失败的重试
        this.planList = JSON.parse(match[1]).map((plan: string) => {
          return {
            name: plan,
            done: false,
            pending: false,
          };
        });
        this.messages.push({
          role: "assistant",
          content: `已规划出实现需求所需的完整步骤，将按顺序执行以下工具，${JSON.stringify(this.planList)}`,
        });
        console.log(
          "[PlanningAgent - planList]",
          JSON.parse(JSON.stringify(this.planList)),
        );
        return true;
      } else {
        // 没有返回计划列表，结束
        this.emits.complete(response.content);
        this.messages.push({
          role: "assistant",
          content: response.content,
        });
      }
      this.messagesCallback(this.messages);
    } else {
      console.log("[PlanningAgent - 请求结果 - 失败/取消]", response);
    }
  }

  private async executePlanList() {
    while (this.planList.length) {
      const plan = this.planList.shift();
      const tool = this.tools.find((tool) => {
        return tool.name === plan!.name;
      })!;

      this.messages.push({
        role: "user",
        content: `调用工具（${tool.name} - ${tool.description}）`,
      });

      this.messagesCallback(this.messages);

      const isLastPlan = !this.planList.length;

      const emitsProxy: Emits = {
        write: (chunk) => {
          this.emits.write(chunk);
          this.messageStreamCallBack(chunk);
        },
        complete: (content) => {
          if (isLastPlan) {
            // 最后一个工具完成后，认为最终完成
            this.emits.complete(content);
          }
        },
        error: (error) => {
          this.emits.error(error);
        },
        cancel: (fn) => {
          this.emits.cancel(fn);
        },
      };

      const messages = [
        {
          role: "system",
          content: getToolPrompt(tool, { attachments: this.attachments }),
        },
        ...this.historyMessages,
        ...this.presetMessages,
        ...this.messages,
      ];
      const response = await this.requestInstance.requestAsStream({
        messages,
        emits: emitsProxy,
        aiRole: tool.aiRole,
      });

      if (response.type === "complete") {
        const files = parseFileBlocks(response.content);
        const content = tool.execute({
          files,
          key: this.key,
          content: response.content,
        });
        this.messages.push({ role: "assistant", content });
        this.messageStreamCallBack(this.messages);
      }
    }
  }

  private loadingCallback = (loading: boolean) => {};

  onLoadingCallback = (cb: any) => {
    cb(this.loading);
    this.loadingCallback = cb;
  };

  offLoadingCallback = () => {
    this.loadingCallback = () => {};
  };

  private messagesCallback = (value: any) => {};

  onMessagesCallback = (fn: any) => {
    fn(this.messages);
    this.messagesCallback = fn;
  };

  offMessagesCallback = () => {
    this.messagesCallback = () => {};
  };

  private messageStreamCallBack = (value: any) => {};

  onMessageStreamCallBack = (fn: any) => {
    fn(this.messages);
    this.messageStreamCallBack = fn;
  };

  offMessageStreamCallBack = () => {
    this.messageStreamCallBack = () => {};
  };
}

export { PlanningAgent };
