import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";
import { Events } from "../utils/events";
import { Request } from "../request/request";
import { IDB } from "../utils/idb";
import { ToolError, normalizeToolMessage } from "../error/toolError";
import { uuid } from "../utils/uuid";
import { RxaiError } from "../error/base";
import { RequestError } from "../error/requestError";
import { retry } from "../utils/retry";

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  tools: Tool[];
  message: string;
  attachments?: Attachment[];
  historyMessages: ChatMessages;
  presetMessages: ChatMessages;
  presetHistoryMessages: ChatMessages;
  planList?: string[];
  extension?: unknown;
  idb?: IDB;
  uuid?: string;
}

type PlanList = {
  name: string;
  status: "pending" | "success" | "error" | null;
}[];

type PlanStatus = "pending" | "success" | "error" | "aborted";

type PlanError = ToolError | RequestError | null;

/**
 * 分析计划
 * 执行计划
 */
class PlanningAgent extends BaseAgent {
  uuid: string;
  planList: PlanList = [];
  planIndex: number = 0;
  private tools: Tool[];
  private emits: Emits;
  private message: string;
  /** 附件 */
  attachments?: Attachment[];
  /** 历史记录 */
  private historyMessages: ChatMessages;
  /** 预设消息，调用方提前注入，仅用于当前plan调用 */
  private presetMessages: ChatMessages;
  /** TODO: 预设历史消息，调用方提前注入，仅存在历史记录 */
  private presetHistoryMessages: ChatMessages;
  /** 用户友好消息列表 */
  private userFriendlyMessages: any[] = [];

  extension?: unknown;

  events = new Events<{
    loading: boolean;
    userFriendlyMessages: any[];
    messageStream: string;
  }>();

  // TODO
  loading = true;

  /** 状态 */
  status: PlanStatus = "pending";

  error: PlanError = null;

  /** 未完成的接口请求 */
  errorMessages: ChatMessages = [];

  idb?: IDB;

  constructor(options: PlanningAgentOptions) {
    super(options);
    this.tools = options.tools;
    this.emits = options.emits;
    this.message = options.message;
    this.attachments = options.attachments;
    this.historyMessages = options.historyMessages;
    this.presetMessages = options.presetMessages;
    this.presetHistoryMessages = options.presetHistoryMessages;
    this.setPlanList(
      options.planList?.map((plan) => {
        return {
          name: plan,
          status: null,
        };
      }) || [],
    );
    this.extension = options.extension;
    this.idb = options.idb;
    this.uuid = options.uuid || uuid();
  }

  getMessages() {
    if (this.loading || this.status === "pending") {
      return [];
    }

    const userRequireMessage = this.messages[0];
    const toolsMessages = this.messages.slice(1);

    const summaryMessage =
      toolsMessages.length > 1
        ? {
            role: "user",
            content: `<对话日志>
${toolsMessages.reduce((acc, cur) => {
  return acc + "\n\n" + cur.content;
}, "")}
</对话日志>`,
          }
        : {
            role: "assistant",
            content: toolsMessages[0]?.content,
          };
    return [...this.presetHistoryMessages, userRequireMessage, summaryMessage];
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
    this.pushMessages([
      {
        role: "user",
        content,
      },
    ]);

    // 推送用户友好消息
    this.emitUserFriendlyMessages({
      messages: [
        {
          role: "user",
          content,
        },
      ],
      type: "push",
    });

    if (this.planList.length) {
      // 外部定义的规划流程
      this.pushMessages([
        {
          role: "assistant",
          content: `已规划出实现需求所需的完整步骤，将按顺序执行以下工具，${this.planList.map((t) => t.name).join("、")}`,
        },
      ]);
    }

    this.start();
  }

  private pushMessages(messages: ChatMessages) {
    // 推送消息
    this.messages.push(...messages);

    this.idb?.putContent({
      id: this.uuid,
      type: "messages",
      content: this.messages,
    });
  }

  private setLoading(loading: boolean) {
    this.loading = loading;
    this.events.emit("loading", loading);
    this.idb?.putContent({
      id: this.uuid,
      type: "loading",
      content: loading,
    });
  }

  private setErrorMessages(errorMessages: ChatMessages) {
    this.errorMessages = errorMessages;
    this.idb?.putContent({
      id: this.uuid,
      type: "errorMessages",
      content: this.errorMessages,
    });
  }

  private setPlanList(planList: PlanList) {
    this.planList = planList;
    this.idb?.putContent({
      id: this.uuid,
      type: "planList",
      content: planList,
    });
  }

  private async start() {
    if (!this.planList.length) {
      this.setLoading(true);
      // 没有规划，获取规划
      await retry(() => {
        this.emitUserFriendlyMessages({
          messages: [],
          type: "update",
        });
        this.setStatus("pending");
        return this.getPlanList();
      }, this.requestInstance.maxRetries);
    }

    // 规划结束立即结束loading，后续状态由工具决定
    this.setLoading(false);
    // 执行工具
    await this.executePlanList();

    if (this.status === "success") {
      this.emits.complete("");
    } else if (this.status === "error") {
      this.emits.error("");
    }
  }

  private getLLMMessages(params: { start?: ChatMessages; end?: ChatMessages }) {
    const { start, end } = params;
    const messages = [
      ...this.historyMessages,
      ...this.presetMessages,
      ...this.messages,
    ];
    if (start) {
      messages.unshift(...start);
    }
    if (end) {
      messages.push(...end);
    }

    messages.push(...this.errorMessages);
    this.setErrorMessages([]);

    return messages;
  }

  private async getPlanList() {
    return new Promise<void>((resolve, reject) => {
      (async () => {
        const messages = this.getLLMMessages({
          start: [
            {
              role: "system",
              content: getSystemPrompt({
                title: this.system.title,
                tools: this.tools,
              }),
            },
          ],
        });

        const response = await this.request({
          messages,
          emits: this.getEmits({}),
        });

        if (response instanceof RxaiError) {
          // this.setErrorMessages([
          //   {
          //     role: "assistant",
          //     content: `规划接口调用错误：${response.message}`,
          //   },
          //   {
          //     role: "user",
          //     content: "请重试",
          //   },
          // ]);
          reject();
          return;
        }

        if (response) {
          // 解析规划内容
          // const match = response!.match(/```bash\s*\n(.+?)\n/);

          // if (match?.[1]) {
          //   // 正常返回计划列表，执行act
          //   // TODO: 解析失败的重试
          //   const planList = match[1]
          //     .split("&&")
          //     .filter((command) => {
          //       return /^node\s+\S+/.test(command.trim());
          //     })
          //     .map((command) => {
          //       return command.trim().replace(/^node\s+/, "");
          //     });

          //   // 工具检查
          //   const { valid, validTools, invalidTools } =
          //     this.validatePlanListTools(planList);

          //   if (!valid) {
          //     const content = `规划错误，使用了不存在的工具(${invalidTools.join(", ")})`;
          //     throw new ToolError({
          //       displayContent: content,
          //       llmContent: content,
          //     });
          //   }

          //   this.setPlanList(
          //     validTools.map((plan: string) => {
          //       return {
          //         name: plan,
          //         status: null,
          //       };
          //     }),
          //   );
          //   this.pushMessages([
          //     {
          //       role: "assistant",
          //       content: response,
          //     },
          //   ]);
          // }

          const bashCommands = parseBashCommands(response);
          console.log("[bashCommands]", bashCommands);
          if (bashCommands.length) {
            const planList = bashCommands.map((command) => {
              return command[1];
            });

            // 工具检查
            const { valid, validTools, invalidTools } =
              this.validatePlanListTools(planList);

            if (!valid) {
              const content = `规划错误，使用了不存在的工具(${invalidTools.join(", ")})`;
              throw new ToolError({
                displayContent: content,
                llmContent: content,
              });
            }

            this.setPlanList(
              validTools.map((plan: string) => {
                return {
                  name: plan,
                  status: null,
                };
              }),
            );
            this.pushMessages([
              {
                role: "assistant",
                content: response,
              },
            ]);
          } else {
            // 没有返回计划列表，结束
            this.emits.complete(response);
            this.pushMessages([
              {
                role: "assistant",
                content: response,
              },
            ]);

            this.emitUserFriendlyMessages({
              messages: [
                {
                  role: "assistant",
                  content: response,
                },
              ],
              type: "push",
            });
            this.setStatus("success");
          }
        }
        this.setPlanError(null);
        resolve();
      })().catch((content) => {
        if (content instanceof ToolError) {
          this.setError(content);
        }
        reject();
      });
    });
  }

  private async executePlanList() {
    // 规划执行结束或状态非pending，停止循环
    while (
      this.planList.length &&
      this.planList.length !== this.planIndex &&
      this.status === "pending"
    ) {
      const plan = this.planList[this.planIndex];

      // 状态变更
      plan.status = "pending";

      try {
        await retry(() => {
          this.setStatus("pending");
          return this.executeTool(plan.name);
        }, this.requestInstance.maxRetries);
        if (this.status === "pending") {
          this.planIndex++;
          this.idb?.putContent({
            id: this.uuid,
            type: "planIndex",
            content: this.planIndex,
          });
          plan.status = "success";
          if (this.planList.length === this.planIndex) {
            this.setStatus("success");
          }
        } else {
          plan.status = "error";
        }
      } catch (error) {
        this.setError(error as NonNullable<PlanError>);
        plan.status = "error";
      }
      this.idb?.putContent({
        id: this.uuid,
        type: "planList",
        content: this.planList,
      });
    }

    return;
  }

  private async executeTool(toolname: string) {
    return new Promise<void>((resolve, reject) => {
      (async () => {
        // 已前置校验过工具，所有tool一定存在
        const tool = this.tools.find((tool) => {
          return tool.name === toolname;
        })!;

        const userFriendlyMessages = [
          {
            role: "tool",
            status: "pending",
            content: {
              name: tool.name,
              displayName: tool.displayName,
            },
          },
        ] as Parameters<
          PlanningAgent["emitUserFriendlyMessages"]
        >[0]["messages"];

        const messages: ChatMessages = [
          {
            role: "user",
            content: `当前正在调用工具（${tool.name}，请根据系统提示词的工具描述、当前聚焦元素、和最近的用户需求提供输出。`,
          },
        ];

        // 工具loading
        this.emitUserFriendlyMessages({
          messages: userFriendlyMessages,
          type: "update",
        });

        /** 是否最后一项 */
        const isLastPlan = this.planList.length - 1 === this.planIndex;
        /** 工具提示词 */
        const toolPrompt = getToolPrompt(tool, {
          attachments: this.attachments,
        });

        let toolResult:
          | PlanError
          | string
          | ReturnType<typeof normalizeToolMessage>;

        if (!toolPrompt) {
          // 没有提示词，走本地调用，执行execute
          const content = await this.toolExecute(tool);
          if (content instanceof RxaiError) {
            if (content instanceof ToolError) {
              this.setErrorMessages([
                ...messages.slice(1),
                {
                  role: "assistant",
                  content: `工具调用错误：${content.message.displayContent}`,
                },
                {
                  role: "user",
                  content: "请重试",
                },
              ]);
            }
            return;
          }
          toolResult = normalizeToolMessage(content);

          // 推送消息
          messages.push({ role: "assistant", content: toolResult.llmContent });
        } else {
          let content = "";

          const stream = tool.stream
            ? (content: string, status: "start" | "ing" | "complete") => {
                tool.stream!({
                  files: parseFileBlocks(content),
                  status,
                });
              }
            : null;

          // const stream = tool.stream
          //   ? throttle((content, status) => {
          //       tool.stream!({
          //         files: parseFileBlocks(content),
          //         status,
          //       });
          //     }, 1000)
          //   : null;

          stream?.("", "start");

          const llmMessages = this.getLLMMessages({
            start: [
              {
                role: "system",
                content: getToolPrompt(tool, { attachments: this.attachments }),
              },
            ],
            end: messages,
          });

          const response = await this.request({
            messages: llmMessages,
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

          if (response instanceof RxaiError) {
            // this.setErrorMessages([
            //   ...messages.slice(1),
            //   {
            //     role: "assistant",
            //     content: `工具调用调用错误：${response.message}`,
            //   },
            //   {
            //     role: "user",
            //     content: "请重试",
            //   },
            // ]);
            reject();
            return;
          }

          // 解析文件
          const files = parseFileBlocks(response);

          // 执行工具
          toolResult = await this.toolExecute(tool, {
            files,
            content: response,
          });

          if (toolResult instanceof RxaiError) {
            if (toolResult instanceof ToolError) {
              this.setErrorMessages([
                ...messages.slice(1),
                {
                  role: "assistant",
                  content: `工具调用错误：${toolResult.message.displayContent}`,
                },
                {
                  role: "user",
                  content: "请重试",
                },
              ]);
            } else {
              reject();
            }
            return;
          }

          toolResult = normalizeToolMessage(toolResult);

          messages.push({ role: "assistant", content: toolResult.llmContent });
        }

        if (isLastPlan) {
          // 最后一项
          if (tool.lastAppendMessage) {
            // 工具执行完成后需要默认再调用一次请求
            const llmMessages = this.getLLMMessages({
              start: [
                {
                  role: "system",
                  content: getToolPrompt(tool, {
                    attachments: this.attachments,
                  }),
                },
              ],
              end: [
                ...messages,
                {
                  role: "user",
                  content: tool.lastAppendMessage,
                },
              ],
            });

            const response = await this.request({
              messages: llmMessages,
              emits: this.getEmits({
                write: (chunk) => {
                  this.events.emit("messageStream", chunk);
                },
              }),
              aiRole: tool.aiRole,
            });

            if (response instanceof RxaiError) {
              // this.setErrorMessages([
              //   ...messages.slice(1),
              //   {
              //     role: "assistant",
              //     content: `工具调用调用错误：${response.message}`,
              //   },
              //   {
              //     role: "user",
              //     content: "请重试",
              //   },
              // ]);
              reject();
              return;
            }

            if (response) {
              // 工具状态更新
              userFriendlyMessages[0].status = "success";
              // 推送消息
              userFriendlyMessages.push({
                role: "assistant",
                content: response,
              });
            }
          } else if (tool.streamThoughts) {
            userFriendlyMessages.push({
              role: "assistant",
              content: toolResult.displayContent,
            });
          } else {
            userFriendlyMessages.push({
              role: "assistant",
              content: toolResult.displayContent,
            });
          }

          // 最后一个工具完成后，认为最终完成
          this.emits.complete(toolResult.llmContent);
        }

        userFriendlyMessages[0].status = "success";

        // 清除toolError
        this.setPlanError(null);

        // 完成请求，推送消息
        this.pushMessages(messages);

        this.emitUserFriendlyMessages({
          messages: userFriendlyMessages,
          type: "push",
        });

        resolve();
      })()
        .then(resolve)
        .catch(reject);
    });
  }

  /** 用户友好消息推送 */
  private emitUserFriendlyMessages(params: {
    messages: (ChatMessages[number] & {
      status?: "pending" | "success" | "error" | "aborted";
    })[];
    type: "push" | "update";
  }) {
    const { type, messages } = params;

    if (type === "push") {
      this.userFriendlyMessages.push(...messages);
      this.events.emit("userFriendlyMessages", this.userFriendlyMessages);
      this.idb?.putContent({
        id: this.uuid,
        type: "userFriendlyMessages",
        content: this.userFriendlyMessages,
      });
    } else {
      this.events.emit("userFriendlyMessages", [
        ...this.userFriendlyMessages,
        ...messages,
      ]);
    }
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
        this.setStatus("error");
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
    const response = await this.requestInstance.requestAsStream({
      ...params,
      enableLog: this.enableLog,
    });
    if (response.type === "error") {
      this.setError(response.content);
      return response.content;
    } else if (response.type === "cancel") {
      const error = new RequestError("已取消执行");
      // const toolError = new ToolError({
      //   displayContent: "已取消执行",
      //   llmContent: "已取消执行",
      // });
      this.setError(error);
      return error;
    }
    return response.content;
  }

  private async toolExecute(
    tool: Tool,
    params?: Parameters<Tool["execute"]>[0],
  ): Promise<
    | string
    | { displayContent: string; llmContent: string }
    | NonNullable<PlanError>
  > {
    try {
      const result = await tool.execute(params!);
      return result;
    } catch (e) {
      const toolError = e as NonNullable<PlanError>;
      this.setError(toolError);
      return toolError;
    }
  }

  async retry() {
    this.emitUserFriendlyMessages({
      messages: [],
      type: "update",
    });
    this.setStatus("pending");
    this.start();
  }

  /**
   * 检查计划列表中的工具是否存在
   * @param planList 工具名称列表
   * @returns 检查结果，valid为true时表示所有工具都存在
   */
  private validatePlanListTools(planList: string[]): {
    valid: boolean;
    validTools: string[];
    invalidTools: string[];
  } {
    const validTools: string[] = [];
    const invalidTools: string[] = [];

    for (const plan of planList) {
      const tool = this.tools.find((tool) => tool.name === plan);
      if (tool) {
        validTools.push(plan);
      } else {
        invalidTools.push(plan);
      }
    }

    return {
      valid: invalidTools.length === 0,
      validTools,
      invalidTools,
    };
  }

  private setPlanError(error: PlanError) {
    this.error = error;
    this.idb?.putContent({
      id: this.uuid,
      type: "error",
      content: error
        ? {
            message: error.message,
            type: error.type,
          }
        : null,
    });
  }

  private setError(error: NonNullable<PlanError>) {
    this.setStatus("error");
    this.setPlanError(error);
    this.emitUserFriendlyMessages({
      messages: [
        {
          role: "error",
          content:
            error instanceof ToolError
              ? error.message.displayContent
              : error.message,
        },
      ],
      type: "update",
    });
  }

  private setStatus(status: PlanStatus) {
    this.status = status;
    this.idb?.putContent({
      id: this.uuid,
      type: "status",
      content: status,
    });
  }

  getDBContent() {
    return {
      uuid: this.uuid,
      extension: this.extension,
      enableLog: this.enableLog,
      attachments: this.attachments,
      message: this.message,
      presetHistoryMessages: this.presetHistoryMessages,
      presetMessages: this.presetMessages,
    };
  }

  recover(params: any) {
    params.forEach(({ type, content }: any) => {
      if (type === "error") {
        if (content) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          this[type] =
            content.type === "tool"
              ? new ToolError(content.message)
              : new RequestError(content.message);
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this[type] = content;
      }
    });

    if (this.status === "pending") {
      // 未正常完成，设置为取消状态
      this.status = "aborted";
    }

    this.loading = false;
    this.events.emit("loading", false);

    const userFriendlyMessages = [...this.userFriendlyMessages];

    if (this.error) {
      userFriendlyMessages.push({
        role: "error",
        content:
          this.error instanceof RequestError
            ? this.error.message
            : this.error.message.displayContent,
      });
    } else if (this.status === "aborted") {
      userFriendlyMessages.push({
        role: "aborted",
        content: "已取消",
      });
    }

    this.events.emit("userFriendlyMessages", userFriendlyMessages);
  }
}

export { PlanningAgent };

function parseBashCommands(string: string) {
  const bashCodeRegex = /```\s*bash([\s\S]*?)```/;
  const matchResult = string.match(bashCodeRegex);

  if (!matchResult) return [];

  const bashContent = matchResult[1].trim();
  const subCommands = bashContent.split("&&").map((cmd) => cmd.trim());
  const commandArray = subCommands.map((cmd) =>
    cmd.split(/\s+/).filter(Boolean),
  );

  return commandArray;
}
