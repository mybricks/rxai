import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";
import { throttle } from "../utils/throttle";
import { Events } from "../utils/events";
import { Request } from "../request/request";
import { ToolError, normalizeToolMessage } from "../tool/base";

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

  /** 状态 */
  status: "pending" | "success" | "error" | "aborted" = "pending";

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
    // 拼user消息
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

    // 推送消息
    this.messages.push({
      role: "user",
      content,
    });

    // 推送用户友好消息
    this.pushUserFriendlyMessages({
      role: "user",
      content,
    });

    if (!this.planList.length) {
      // 没有规划，获取规划
      await this.getPlanList();
    } else {
      // 外部定义的规划流程
      this.messages.push({
        role: "assistant",
        content: `已规划出实现需求所需的完整步骤，将按顺序执行以下工具，${this.planList.map((t) => t.name).join("、")}`,
      });
    }

    // 规划结束即结束loading，后续状态由工具决定
    this.loading = false;
    this.events.emit("loading", this.loading);
    // 执行工具
    await this.executePlanList();
  }

  private async getPlanList() {
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

    const response = await this.request({
      messages,
      emits: this.getEmits({}),
    });

    if (response) {
      // 解析规划内容
      const match = response!.match(/```bash\s*\n(.+?)\n/);

      if (match?.[1]) {
        // 正常返回计划列表，执行act
        // TODO: 解析失败的重试

        const planList = match[1]
          .split("&&")
          .filter((command) => {
            return /^node\s+\S+/.test(command.trim());
          })
          .map((command) => {
            return command.trim().replace(/^node\s+/, "");
          });

        // 工具检查
        let errorTools = "";

        const checkPlanList = planList.filter((plan) => {
          const tool = this.tools.find((tool) => {
            return tool.name === plan;
          });
          if (!tool) {
            if (!errorTools) {
              errorTools = plan;
            } else {
              errorTools += `, ${plan}`;
            }
            return false;
          }

          return true;
        });

        if (checkPlanList.length !== planList.length) {
          this.status = "error";
          const content = `规划错误，使用了不存在的工具(${errorTools})`;
          console.error(content);
          this.pushUserFriendlyMessages({
            role: "error",
            content,
          });
          this.messages.push({
            role: "assistant",
            content,
          });
          return;
        }

        this.planList = planList.map((plan: string) => {
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
        return true;
      } else {
        // 没有返回计划列表，结束
        this.emits.complete(response);
        this.messages.push({
          role: "assistant",
          content: response,
        });

        this.pushUserFriendlyMessages({
          role: "assistant",
          content: response,
        });
      }
    }
  }

  private async executePlanList() {
    // 规划执行结束或状态非pending，都停止循环
    while (this.planList.length && this.status === "pending") {
      const plan = this.planList.shift();
      const tool = this.tools.find((tool) => {
        return tool.name === plan!.name;
      })!;

      this.messages.push({
        role: "user",
        content: `调用工具（${tool.name} - ${tool.description}）`,
      });

      this.pushUserFriendlyMessages({
        role: "tool",
        status: "pending",
        content: tool,
      });

      /** 是否最后一项 */
      const isLastPlan = !this.planList.length;
      /** 工具提示词 */
      const toolPrompt = getToolPrompt(tool, { attachments: this.attachments });

      if (!toolPrompt) {
        // 没有提示词，走本地调用，执行execute
        const content = await this.toolExecute(tool);
        if (content instanceof ToolError) {
          continue;
        }
        const { displayContent, llmContent } = normalizeToolMessage(content);

        this.messages.push({ role: "assistant", content: llmContent });
        this.userFriendlyMessages[this.userFriendlyMessages.length - 1].status =
          "success";

        if (isLastPlan || tool.streamThoughts) {
          // 最后一项或者需要展示结果
          this.pushUserFriendlyMessages({
            role: "assistant",
            content: displayContent,
          });
        }

        if (isLastPlan) {
          // 最后一项
          if (tool.lastAppendMessage) {
            // 工具执行完成后需要默认再调用一次请求
            const messages = [
              {
                role: "system",
                content: getToolPrompt(tool, { attachments: this.attachments }),
              },
              ...this.historyMessages,
              ...this.presetMessages,
              ...this.messages,
              {
                role: "user",
                content: tool.lastAppendMessage,
              },
            ];

            const response = await this.request({
              messages,
              emits: this.getEmits({
                write: (chunk) => {
                  this.events.emit("messageStream", chunk);
                },
              }),
              aiRole: tool.aiRole,
            });

            if (!response) {
              continue;
            }

            if (response) {
              this.pushUserFriendlyMessages({
                role: "assistant",
                content: response,
              });
            }
          }

          // 最后一个工具完成后，认为最终完成
          this.emits.complete(llmContent);
        }
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

      const messages = [
        {
          role: "system",
          content: getToolPrompt(tool, { attachments: this.attachments }),
        },
        ...this.historyMessages,
        ...this.presetMessages,
        ...this.messages,
      ];

      const response = await this.request({
        messages,
        emits: this.getEmits({
          write: (chunk) => {
            if (tool.streamThoughts) {
              this.events.emit("messageStream", chunk);
            }

            content += chunk;
            stream?.(content, "ing");
          },
          complete: (content) => {
            stream?.(content, "complete");
          },
        }),
        aiRole: tool.aiRole,
      });

      if (!response) {
        continue;
      }

      if (response) {
        // 解析文件
        const files = parseFileBlocks(response);

        // 执行工具
        const content = await this.toolExecute(tool, {
          files,
          key: this.key,
          content: response,
        });

        if (content instanceof ToolError) {
          continue;
        }

        const { displayContent, llmContent } = normalizeToolMessage(content);

        this.messages.push({ role: "assistant", content: llmContent });
        this.userFriendlyMessages[this.userFriendlyMessages.length - 1].status =
          "success";

        if (isLastPlan) {
          // 最后一步
          if (!tool.lastAppendMessage) {
            // 不需要再次请求
            this.pushUserFriendlyMessages({
              role: "assistant",
              content: displayContent,
            });
          }

          if (tool.lastAppendMessage) {
            // 需要再次发起请求
            const messages = [
              {
                role: "system",
                content: getToolPrompt(tool, { attachments: this.attachments }),
              },
              ...this.historyMessages,
              ...this.presetMessages,
              ...this.messages,
              {
                role: "user",
                content: tool.lastAppendMessage,
              },
            ];
            const response = await this.request({
              messages,
              aiRole: tool.aiRole,
              emits: this.getEmits({
                write: (chunk) => {
                  this.events.emit("messageStream", chunk);
                },
              }),
            });

            if (!response) {
              continue;
            }

            if (response) {
              this.pushUserFriendlyMessages({
                role: "assistant",
                content: response,
              });
            }
          }

          // 最后一个工具完成后，认为最终完成
          this.emits.complete(llmContent);
        } else {
          this.pushUserFriendlyMessages();
        }
      }
    }
  }

  /** 用户友好消息推送 */
  private pushUserFriendlyMessages(
    message?: ChatMessages[number] & {
      status?: "pending" | "success" | "error" | "aborted";
    },
  ) {
    if (message) {
      this.userFriendlyMessages.push(message);
    }

    this.events.emit("userFriendlyMessages", this.userFriendlyMessages);
  }

  /** emits代理 */
  private getEmits(emits: Partial<Emits>): Emits {
    return {
      write: (chunk) => {
        this.emits.write(chunk);
        emits?.write?.(chunk);
      },
      complete: (content) => {
        emits?.complete?.(content);
      },
      error: (error) => {
        this.emits.error(error);
        this.status = "error";
        console.error(error);
        emits?.error?.(error);
      },
      cancel: (fn) => {
        this.emits.cancel(fn);
        emits?.cancel?.(fn);
      },
    };
  }

  private async request(params: Parameters<Request["requestAsStream"]>[0]) {
    try {
      const response = await this.requestInstance.requestAsStream({
        ...params,
        enableLog: this.enableLog,
      });
      if (response.type === "error") {
        this.pushUserFriendlyMessages({
          role: "error",
          content: `接口调用错误：${response.content instanceof Error ? response.content.message : response.content}`,
        });
        return null;
      } else if (response.type === "cancel") {
        this.pushUserFriendlyMessages({
          role: "error",
          content: "已取消执行",
        });
        return null;
      }
      return response.content;
    } catch (e) {
      this.pushUserFriendlyMessages({
        role: "error",
        content: `接口调用错误：${e instanceof Error ? e.message : e}`,
      });
      return null;
    }
  }

  private async toolExecute(
    tool: Tool,
    params?: Parameters<Tool["execute"]>[0],
  ): Promise<
    string | { displayContent: string; llmContent: string } | ToolError
  > {
    try {
      const result = await tool.execute(params!);
      return result;
    } catch (e) {
      this.status = "error";
      this.userFriendlyMessages[this.userFriendlyMessages.length - 1].status =
        "error";

      let displayContent = "";
      let llmContent = "";
      let result = e;

      if (e instanceof ToolError) {
        const message = e.message;
        displayContent = message.displayContent;
        llmContent = message.llmContent;
      } else if (e instanceof Error) {
        displayContent = llmContent = e.message;
        result = new ToolError({ displayContent, llmContent: displayContent });
      } else {
        console.error("[Rxai - error]: 请使用「ToolError」提供错误信息");
        displayContent = llmContent = "工具调用错误";
        result = new ToolError({
          displayContent,
          llmContent,
        });
      }

      console.error(e);
      this.pushUserFriendlyMessages({
        role: "error",
        content: displayContent,
      });
      this.messages.push({
        role: "assistant",
        content: llmContent,
      });

      return result as ToolError;
    }
  }
}

export { PlanningAgent };
