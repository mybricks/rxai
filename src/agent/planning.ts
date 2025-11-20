import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";
import { throttle } from "../utils/throttle";
import { Events } from "../utils/events";

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  tools: Tool[];
  key: string;
  message: string;
  attachments?: Attachment[];
  historyMessages: ChatMessages;
  presetMessages: ChatMessages;
  planList?: string[];
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
  /** 附件 */
  private attachments?: Attachment[];
  /** 历史记录 */
  private historyMessages: ChatMessages;
  /** 预设消息，调用方提前注入 */
  private presetMessages: ChatMessages;
  /** 用户友好消息列表 */
  private userFriendlyMessages: any[] = [];

  events = new Events<{
    loading: boolean;
    userFriendlyMessages: any[];
    messageStream: string;
  }>();

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
    this.planList =
      options.planList?.map((plan) => {
        return {
          name: plan,
          done: false,
          pending: false,
        };
      }) || [];
  }

  getMessages() {
    if (this.loading) {
      return [];
    }
    return [...this.presetMessages, ...this.messages];
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

    this.userFriendlyMessages.push({
      role: "user",
      content,
    });

    this.events.emit("userFriendlyMessages", this.userFriendlyMessages);

    if (!this.planList.length) {
      await this.getPlanList();
    } else {
      this.messages.push({
        role: "assistant",
        content: `已规划出实现需求所需的完整步骤，将按顺序执行以下工具，${this.planList.map((t) => t.name).join("、")}`,
      });
    }

    // 结束
    this.loading = false;
    this.events.emit("loading", this.loading);
    await this.executePlanList();
  }

  private async getPlanList() {
    const emitsProxy: Emits = {
      write: (chunk) => {
        this.emits.write(chunk);
        this.events.emit("messageStream", chunk);
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
    });

    if (response.type === "complete") {
      this.userFriendlyMessages.push({
        role: "assistant",
        content: response.content,
      });
      // const match = response.content!.match(
      //   /file="planList\.json"[\s\S]*?(\[[\s\S]*?\])/,
      // );
      const match = response.content!.match(/```bash\s*\n(.+?)\n/);

      if (match?.[1]) {
        // 正常返回计划列表，执行act
        // TODO: 解析失败的重试
        this.planList = match[1]
          .split("&&")
          .filter((command) => {
            return /^node\s+\S+/.test(command.trim());
          })
          .map((command) => {
            return command.trim().replace(/^node\s+/, "");
          })
          .map((plan: string) => {
            return {
              name: plan,
              done: false,
              pending: false,
            };
          });
        this.messages.push({
          role: "assistant",
          content: `已规划出实现需求所需的完整步骤，将按顺序执行以下工具，${this.planList.map((t) => t.name).join("、")}`,
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

        console.log("[PlanningAgent - raw response]", response.content);
      }
      this.events.emit("userFriendlyMessages", this.userFriendlyMessages);
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

      this.userFriendlyMessages.push({
        role: "tool",
        status: "pending",
        content: tool,
      });

      this.events.emit("userFriendlyMessages", this.userFriendlyMessages);

      const isLastPlan = !this.planList.length;

      const toolPrompt = getToolPrompt(tool, { attachments: this.attachments });

      if (!toolPrompt) {
        const content = await tool.execute();
        this.messages.push({ role: "assistant", content });

        this.userFriendlyMessages[this.userFriendlyMessages.length - 1].status =
          "success";

        if (isLastPlan) {
          this.userFriendlyMessages.push({
            role: "assistant",
            content,
          });
        }

        this.events.emit("userFriendlyMessages", this.userFriendlyMessages);
        continue;
      }

      let content = "";

      const stream = tool.stream
        ? throttle((content, status) => {
            tool.stream!({
              files: parseFileBlocks(content),
              status,
            });
          }, 1000)
        : null;

      stream?.("", "start");

      const emitsProxy: Emits = {
        write: (chunk) => {
          this.emits.write(chunk);
          // this.events.emit("messageStream", chunk);

          content += chunk;
          stream?.(content, "ing");
        },
        complete: (content) => {
          stream?.(content, "complete");
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

        this.userFriendlyMessages[this.userFriendlyMessages.length - 1].status =
          "success";

        if (isLastPlan) {
          this.userFriendlyMessages.push({
            role: "assistant",
            content,
          });
        }

        this.events.emit("userFriendlyMessages", this.userFriendlyMessages);
      } else {
        console.error("[rxai - 工具未正常调用]", response);
      }
    }
  }
}

export { PlanningAgent };
