/* eslint-disable @typescript-eslint/ban-ts-comment */
import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";
import { Events } from "../utils/events";
import { Request } from "../request/request";
import { IDB } from "../utils/idb";
import { ToolError } from "../error/toolError";
import { uuid } from "../utils/uuid";
import { RxaiError } from "../error/base";
import { RequestError } from "../error/requestError";
import { retry } from "../utils/retry";
import { RetryError } from "../error/retryError";

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  tools: Tool[];
  message: string;
  attachments?: Attachment[];
  historyMessages: ChatMessages;
  presetMessages: ChatMessages | (() => ChatMessages);
  presetHistoryMessages: ChatMessages;
  formatUserMessage?: (msg: any) => any;
  planList?: string[];
  extension?: unknown;
  idb?: IDB;
  uuid?: string;
  planningCheck?: (
    bashCommands: [
      string,
      string,
      {
        [key: string]: string;
      },
    ][],
  ) =>
    | [
        string,
        string,
        {
          [key: string]: string;
        },
      ][]
    | null;
}

type PlanStatus = "pending" | "success" | "error" | "aborted";

/** 没有response */
const CATCH_EMPTY = Symbol("CATCH_EMPTY");

type PlanError = ToolError | RequestError | null;

type CommandStatus = "pending" | "success" | "error" | null;

type EventsKV = {
  loading: boolean;
  userFriendlyMessages: any[];
  streamMessage: string;
  streamMessage2: string;
  userMessage: ReturnType<PlanningAgent["getUserMessage"]>;
  startTime: number;
  summary: string;
  commands: PlanningAgent["commands"];
  error: string;
};

/**
 * 分析计划
 * 执行计划
 */
class PlanningAgent extends BaseAgent {
  private startTime: number = 0;
  private endTime: number = 0;
  private llmContent: string = "";
  private loading: boolean = false;
  private commands: {
    startTime: number;
    endTime: number;
    argv: [
      string,
      string,
      {
        [key: string]: string;
      },
    ];
    status: CommandStatus;
    tool: {
      name: string;
      displayName: string;
    };
    content: {
      llm: string;
      display: string;
      response: string;
    };
    events?: Events<{ streamMessage: { message: string; status: string } }>;
  }[] = [];

  private defaultPlanList = false;

  constructor(private options: PlanningAgentOptions) {
    super(options);
    // 设置UUID
    this.uuid = options.uuid || uuid();
    if (options.planList) {
      // 配置默认的规划列表
      const time = new Date().getTime();
      const llmContent =
        "```bash" +
        `\n${options.planList.reduce((pre, cur) => {
          return (pre ? pre + " && " : pre) + `node ${cur}`;
        }, "")}` +
        "\n```";

      this.setStartTime(time);
      this.setEndTime(time);
      this.setLlmContent(llmContent);
      this.setLoading(false);
      this.setCommands(
        parseBashCommands(llmContent).map((argv) => {
          return {
            startTime: 0,
            endTime: 0,
            argv,
            status: null,
            tool: {
              name: argv[1],
              displayName: argv[1],
            },
            content: {
              llm: "",
              display: "",
              response: "",
            },
          };
        }),
        false,
      );

      this.defaultPlanList = true;
    }
    // 设置userMessage
    this.events.emit("userMessage", this.getUserMessage());
  }

  /** 随机ID，保证唯一性 */
  private uuid: string;

  /** 事件 */
  events = new Events<EventsKV>();

  /** 整体运行状态 */
  private status: PlanStatus = "pending";

  /** error信息 */
  private error: PlanError = null;

  enableRetry: boolean = true;

  get id() {
    return this.uuid;
  }

  /** 开始执行 */
  async run() {
    // 记录开始时间
    this.setStartTime(new Date().getTime());

    await this.start();
  }

  private async start() {
    this.setStatus("pending");

    if (!this.commands.length) {
      // 没有commands，需要规划
      this.setLoading(true);

      await this.tryCatch(
        () =>
          retry(
            () => {
              return this.planning();
            },
            this.options.requestInstance.maxRetries,
            (error) => {
              return error instanceof RequestError;
            },
          ),
        true,
      );

      this.setLoading(false);
    }

    await this.executeCommands();

    // 执行结束，调用emits回调通知调用方
    if (this.status === "success") {
      this.options.emits.complete("");
    } else if (this.status === "error") {
      this.options.emits.error("");
    }
  }

  /** 设置需缓存的值 */
  private setStartTime(startTime: PlanningAgent["startTime"]) {
    this.startTime = startTime;
    this.idbPubContent("startTime", startTime);
  }
  private setEndTime(endTime: PlanningAgent["endTime"]) {
    this.endTime = endTime;
    this.idbPubContent("endTime", endTime);
  }
  private setLlmContent(llmContent: PlanningAgent["llmContent"]) {
    this.llmContent = llmContent;
    this.idbPubContent("llmContent", llmContent);
  }
  private setLoading(loading: PlanningAgent["loading"]) {
    this.loading = loading;
    this.events.emit("loading", loading);
  }
  private setCommands(commands: PlanningAgent["commands"], sync: boolean) {
    this.commands = commands.map((command) => {
      if (!command.events) {
        command.events = new Events();
      }
      return {
        ...command,
      };
    });
    this.events.emit("commands", commands);
    if (sync) {
      this.idbPubContent(
        "commands",
        commands.map((command) => {
          const { events, ...other } = command;
          return other;
        }),
      );
    }
  }
  private idbPubContent(type: string, content: any) {
    this.options.idb?.putContent({
      id: this.uuid,
      type,
      content,
    });
  }

  /** 规划 */
  private async planning() {
    const { options } = this;

    const planningResponse = await this.request({
      messages: this.getLLMMessages({
        start: [
          {
            role: "system",
            content: getSystemPrompt({
              title: this.system.title,
              tools: options.tools,
              prompt: this.system.prompt,
            }),
          },
        ],
      }),
      emits: this.getEmits(),
    });

    if (planningResponse instanceof RxaiError) {
      // 规划出错
      return;
    }

    this.setLlmContent(planningResponse);

    let bashCommands = parseBashCommands(planningResponse);

    if (!bashCommands.length) {
      // 说明没有规划
      this.events.emit("summary", planningResponse);
      this.setStatus("success");
    } else {
      const { planningCheck } = this.options;

      if (planningCheck) {
        const check = planningCheck(bashCommands);
        if (!check) {
          throw new RequestError("规划结果不符合预期");
        }
        bashCommands = check;
      }

      this.setCommands(
        bashCommands.map((argv) => {
          return {
            startTime: 0,
            endTime: 0,
            argv,
            status: null,
            tool: {
              name: argv[1],
              displayName: argv[1],
            },
            content: {
              llm: "",
              display: "",
              response: "",
            },
          };
        }),
        true,
      );
    }

    this.setEndTime(new Date().getTime());
  }

  /** 执行规划的脚本 */
  private async executeCommands() {
    // 命令
    const commands = this.commands;
    if (!commands.length) {
      // 没有命令
      return;
    }

    // 当前执行到第几个
    let index = commands.findIndex((command) => command.status !== "success");
    if (index === -1) {
      // 命令全部执行完成
      return;
    }

    while (commands.length !== index && this.status === "pending") {
      const command = commands[index];

      // 变更状态，开始执行
      command.status = "pending";
      command.startTime = new Date().getTime();

      this.setCommands(commands, false);

      const [error, response] = await this.tryCatch(
        async () =>
          await retry(
            () => {
              return this.executeCommand(command);
            },
            this.requestInstance.maxRetries, // 暂时都用request配置的maxRetries
            (error) => {
              return error instanceof RequestError;
            },
          ),
        true,
      );

      if (response === CATCH_EMPTY) {
        command.status = "error";
        if (error instanceof ToolError) {
          const message = error.message;
          Object.assign(command.content, {
            llm: message.llmContent,
            display: message.displayContent,
          });
        } else if (error instanceof RequestError || error instanceof Error) {
          const message = error.message;
          Object.assign(command.content, {
            llm: message,
            display: message,
          });
        } else {
          const message = "工具调用错误";
          Object.assign(command.content, {
            llm: message,
            display: message,
          });
        }
        this.setError(error);
      } else {
        command.status = "success";
        Object.assign(command.content, response);
        this.setCommands(commands, true);
      }

      command.endTime = new Date().getTime();

      if (this.status === "pending") {
        index++;
        // TODO: idb记录状态
        if (commands.length === index) {
          // 所有工具都执行完成，设置完成状态
          this.setStatus("success");

          // this.events.emit(
          //   "summary",
          //   command.content.display,
          // );
        }
      }
    }
  }

  /**
   * 执行命令
   * 目前均为node命令，后续可能扩展
   */
  private async executeCommand(command: PlanningAgent["commands"][number]) {
    const { argv } = command;
    const [, name, params = {}] = argv;

    // 已经前置校验过工具合法性，所以tool一定是有的
    const tool = this.options.tools.find((tool) => {
      return tool.name === name;
    })!;

    command.tool.displayName = tool.displayName;

    /** 工具提示词 */
    const toolPrompt = getToolPrompt(tool, {
      attachments: this.options.attachments,
    });

    const content = {
      llm: "",
      display: "",
      response: "",
    };

    const toolExecute = async (
      tool: Tool,
      params: Parameters<Tool["execute"]>[0],
    ) => {
      const [error, response] = await this.tryCatch(() => {
        return tool.execute(params);
      });

      if (response === CATCH_EMPTY) {
        throw error;
      }

      if (typeof response === "string") {
        return {
          llm: response,
          display: response,
        };
      } else {
        return {
          llm: response.llmContent,
          display: response.displayContent,
        };
      }
    };

    if (!toolPrompt) {
      // 没有提示词，走本地调用，执行execute
      Object.assign(
        content,
        await toolExecute(tool, {
          params,
          files: [],
          content: "",
          replaceContent: "",
        }),
      );
    } else {
      let streamMessage = "";

      const stream = tool.stream
        ? (content: string, status: "start" | "ing" | "complete") => {
            const { content: replaceContent, files } = parseFileBlocks(content);
            const res = tool.stream!({
              files,
              status,
              replaceContent,
            });
            if (typeof res === "string") {
              // this.events.emit("streamMessage2", res);
              command.events?.emit("streamMessage", {
                message: res,
                status,
              });
            }
          }
        : (content: string, status: "start" | "ing" | "complete") => {
            command.events?.emit("streamMessage", {
              message: content,
              status,
            });
          };

      stream?.("", "start");

      const llmMessages = this.getLLMMessages({
        start: [
          {
            role: "system",
            content: getToolPrompt(tool, {
              attachments: this.options.attachments,
            }),
          },
        ],
      });

      const response = await this.request({
        messages: llmMessages,
        emits: this.getEmits({
          write: (chunk) => {
            // if (tool.streamThoughts) {
            //   this.events.emit("streamMessage", chunk);
            // }

            streamMessage += chunk;
            command.content.response = streamMessage;
            stream?.(streamMessage, "ing");
            // if (!stream) {
            //   command.events?.emit("streamMessage", {
            //     message: streamMessage,
            //     status: "ing",
            //   });
            //   this.events.emit("streamMessage", chunk);
            // }
          },
          complete: (content) => {
            stream?.(content, "complete");
          },
        }),
        aiRole: tool.aiRole,
      });

      if (response instanceof RxaiError) {
        throw response;
      }

      // 解析文件
      const { files, content: replaceContent } = parseFileBlocks(response);

      Object.assign(
        content,
        await toolExecute(tool, {
          params,
          files,
          content: response,
          replaceContent,
        }),
        { response },
      );
    }

    return content;
  }

  /** emits代理 */
  private getEmits(emits?: Partial<Emits>): Emits {
    const { options } = this;
    return {
      write: (chunk) => {
        options.emits.write(chunk);
        emits?.write?.(chunk);
      },
      complete: (content) => {
        emits?.complete?.(content);
      },
      error: (error) => {
        options.emits.error(error);
        // this.setStatus("error");
        console.error(error);
        emits?.error?.(error);
      },
      cancel: (fn) => {
        options.emits.cancel(fn);
        emits?.cancel?.(fn);
      },
    };
  }

  /** 获取用户需求 */
  private getUserMessage() {
    const { options } = this;
    return {
      role: "user",
      content: options.attachments?.length
        ? [
            {
              type: "text",
              text: options.message,
            },
            ...options.attachments
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
        : options.message,
    };
  }

  private formatUserMessage(
    userMessage: any,
    formatFunction: (msg: string) => string,
  ) {
    let userTextMessage;
    let newUserMessage;

    // 提取用户消息内容并创建新的消息对象
    if (typeof userMessage?.content === "string") {
      newUserMessage = { ...userMessage };
      userTextMessage = userMessage.content;
    } else if (Array.isArray(userMessage?.content)) {
      newUserMessage = {
        ...userMessage,
        content: [...userMessage.content],
      };
      const idx = userMessage.content.findIndex(
        (item: any) => item.type === "text",
      );
      userTextMessage = userMessage.content[idx]?.text;
    }

    // 通过format函数处理文本内容
    const formattedText = formatFunction(userTextMessage);

    // 将格式化后的内容塞回新消息对象
    if (typeof userMessage?.content === "string") {
      newUserMessage.content = formattedText;
    } else if (Array.isArray(userMessage?.content)) {
      const idx = userMessage.content.findIndex(
        (item: any) => item.type === "text",
      );
      if (idx !== -1) {
        newUserMessage.content[idx].text = formattedText;
      }
    }

    return newUserMessage;
  }

  /** 获取对话消息列表 */
  private getLLMMessages(params: { start?: ChatMessages; end?: ChatMessages }) {
    const { options } = this;
    const { start, end } = params;

    const messages = [
      ...options.historyMessages,
      ...(typeof options.presetMessages === "function"
        ? options.presetMessages()
        : options.presetMessages),
      typeof options.formatUserMessage === "function"
        ? this.formatUserMessage(
            this.getUserMessage(),
            options.formatUserMessage,
          )
        : this.getUserMessage(),
    ];

    let toolMessage = "";
    let toolPendingMessage = "";

    if (this.commands.length) {
      toolMessage =
        "以下是对完成当前需求所需的待执行bash命令列表，将严格按照顺序执行" +
        "\n## 待执行bash命令列表";

      for (const command of this.commands) {
        if (command.status === null) {
          break;
        }

        const { argv } = command;
        const [bash, name, params = {}] = argv;
        const success = command.status === "success";
        toolMessage +=
          `\n- [${success ? "x" : " "}] ${bash} ${name} ${Object.entries(
            params,
          ).reduce((acc, [key, value]) => {
            return acc + `-${key} ${value} `;
          }, "")}` +
          (success
            ? `\nstdout：${command.content.llm || command.content.display}`
            : "");

        if (command.status === "pending") {
          toolPendingMessage =
            `\n\n当前正在执行命令 ${bash} ${name} ${Object.entries(
              params,
            ).reduce((acc, [key, value]) => {
              return acc + `-${key} ${value} `;
            }, "")}` +
            (this.error instanceof ToolError
              ? `\nzsh: ${this.error.message.llmContent}` +
                "\n\n执行命令报错，请重试。"
              : "\n请") +
            "根据系统提示词的工具描述提供输出。";
        }
      }

      messages.push({
        role: "user",
        content: toolMessage + toolPendingMessage,
      });
    }

    if (this.error instanceof RetryError) {
      messages.push({
        role: "user",
        // @ts-ignore
        content: `上次规划出错，错误信息为 ${(this.error?.error || this.error?.message)?.llmContent}，请基于用户消息重新规划。`,
      });
    }

    // for (const command of this.commands) {
    //   if (command.status === null) {
    //     break;
    //   }

    //   if (command.status === "success") {
    //     messages.push(
    //       {
    //         role: "user",
    //         content: `当前正在调用工具（${command.tool.name}，请根据系统提示词的工具描述、当前聚焦元素、和最近的用户需求提供输出。`,
    //       },
    //       {
    //         role: "assistant",
    //         content: command.content.llm || command.content.display,
    //       },
    //     );
    //   } else {
    //     messages.push({
    //       role: "user",
    //       content: `当前正在调用工具（${command.tool.name}，请根据系统提示词的工具描述、当前聚焦元素、和最近的用户需求提供输出。`,
    //     });
    //   }
    // }

    // if (this.error instanceof ToolError) {
    //   messages.push(
    //     {
    //       role: "assistant",
    //       content: `工具调用错误：${this.error.message.llmContent}`,
    //     },
    //     {
    //       role: "user",
    //       content: "请重试",
    //     },
    //   );
    // }

    if (start) {
      messages.unshift(...start);
    }
    if (end) {
      messages.push(...end);
    }

    this.setError(null);

    return messages;
  }

  /** 请求统一封装 */
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
      this.setError(error);
      return error;
    }
    return response.content;
  }

  /** 统一错误处理 */
  private setError(error: unknown) {
    if (!error) {
      // error清理
      this.error = null;
      this.events.emit("error", "");
      this.idbPubContent("error", null);
      return;
    }
    this.setStatus("error");
    if (error instanceof RxaiError) {
      this.error = error;
    } else {
      const message = (error as Error)?.message || "工具调用错误";
      // 默认为ToolError
      this.error = new ToolError({
        llmContent: message,
        displayContent: message,
      });
    }

    this.idbPubContent("error", {
      message: this.error.message,
      type: this.error.type,
    });

    this.events.emit("error", this.error.message.displayContent);
  }

  /** 设置状态 */
  private setStatus(status: PlanningAgent["status"]) {
    this.status = status;
    this.idbPubContent("status", status);
  }

  /** TODO: 获取DB存储的plan静态数据 */
  getDBContent() {
    const { options } = this;
    return {
      uuid: this.uuid,
      extension: options.extension,
      enableLog: options.enableLog,
      attachments: options.attachments,
      message: options.message,
      presetHistoryMessages: options.presetHistoryMessages,
      presetMessages:
        typeof options.presetMessages === "function"
          ? options.presetMessages()
          : options.presetMessages,
      planList: options.planList,
    };
  }

  /** TODO: 从DB恢复 */
  recover(params: any) {
    this.enableRetry = false;
    params.forEach(({ type, content }: any) => {
      if (type === "error") {
        if (content) {
          const ErrorClassMap = {
            tool: ToolError,
            request: RequestError,
            retry: RetryError,
          } as const;
          // @ts-ignore
          this[type] = new ErrorClassMap[content.type](content.message);
        }
      } else {
        // @ts-ignore
        this[type] = content;
      }
    });

    if (this.status === "pending") {
      // 未正常完成，设置为取消状态
      this.status = "aborted";
    }

    this.setLoading(false);

    const commands = this.commands;
    commands.forEach((command) => {
      if (command.status === "pending") {
        command.status = null;
      }
    });

    this.setCommands(commands, false);

    if (this.error) {
      this.events.emit("error", this.error.message.displayContent);
    } else {
      if (this.status === "aborted") {
        this.events.emit("summary", "已取消");
      } else if (commands.length) {
        const command = commands[commands.length - 1];
        // this.events.emit(
        //   "summary",
        //     command.content.display ||
        //     command.content.llm,
        // );
      } else {
        this.events.emit("summary", this.llmContent);
      }
    }
  }

  /** 获取扩展参数 */
  get extension() {
    return this.options.extension;
  }

  /** TODO: 获取当前plan的总结信息 */
  getMessages() {
    if (this.loading || this.status === "pending" || this.messages.length) {
      return null;
    }
    let message = "";
    if (this.options.presetHistoryMessages?.length) {
      message +=
        "### 系统信息" +
        `${this.options.presetHistoryMessages.reduce((pre, cur) => {
          return pre + `\n${cur.content}`;
        }, "")}`;
    }
    message += "\n\n### 用户消息" + `\n${this.options.message}`;

    if (this.commands.length) {
      message +=
        "\n\n### 工具调用记录" +
        `${this.commands.reduce((pre, command, index) => {
          if (!command.status) {
            return pre;
          }

          // const isLast = this.commands.length - 1 === index;

          const [bash, name, params = {}] = command.argv;

          if (command.status === "success") {
            return (
              pre +
              `\n- [x] ${bash} ${name} ${Object.entries(params).reduce(
                (pre, [key, value]) => {
                  return pre + `-${key} ${value} `;
                },
                "",
              )}` +
              // (isLast
              //   ? `\n${command.content.llm || command.content.display}`
              //   : "")
              `\nstdout：${command.content.llm || command.content.display}`
            );
          } else if (command.status === "error") {
            return (
              pre +
              `\n- [] ${bash} ${name} ${Object.entries(params).reduce(
                (pre, [key, value]) => {
                  return pre + `-${key} ${value} `;
                },
                "",
              )}` +
              `\nzsh：${command.content.llm || command.content.display}`
            );
          }
          return pre;
        }, "")}`;
    }

    message +=
      "\n\n### 状态" +
      (this.status === "success"
        ? `\nsuccess${!this.commands.length ? `：${this.llmContent}` : ""}`
        : "") +
      (this.status === "aborted" ? "\naborted：执行中断" : "") +
      (this.status === "error"
        ? `\nerror：${this.error?.message.llmContent}`
        : "");

    return {
      message,
      attachments: this.options.attachments,
    };
  }

  /** 安全执行 */
  private async tryCatch<T>(
    task: () => T | Promise<T>,
    log: boolean = false,
  ): Promise<[undefined, T] | [unknown, typeof CATCH_EMPTY]> {
    try {
      const result = task();
      if (result instanceof Promise) {
        return [undefined, await result];
      }
      return [undefined, result];
    } catch (e) {
      if (log) {
        console.error("[Rxai - planning - error]", e);
      }
      return [e, CATCH_EMPTY];
    }
  }

  async retry() {
    if (this.error instanceof RetryError) {
      // 从意图识别开始
      if (this.defaultPlanList) {
        // 有默认配置，重制commands
        this.setCommands(
          parseBashCommands(this.llmContent).map((argv) => {
            return {
              startTime: 0,
              endTime: 0,
              argv,
              status: null,
              tool: {
                name: argv[1],
                displayName: argv[1],
              },
              content: {
                llm: "",
                display: "",
                response: "",
              },
            };
          }),
          true,
        );
      } else {
        // 清空规划
        this.setLlmContent("");
        this.setCommands([], true);
      }

      // this.setError(null);
    }

    await this.start();
  }

  export() {
    const { options } = this;
    return {
      uuid: this.uuid,
      options: {
        attachments: options.attachments,
        extension: options.extension,
        message: options.message,
        presetHistoryMessages: options.presetHistoryMessages,
        presetMessages:
          typeof options.presetMessages === "function"
            ? options.presetMessages()
            : options.presetMessages,
      },
      commands: this.commands,
      defaultPlanList: this.defaultPlanList,
      enableLog: this.enableLog,
      enableRetry: this.enableRetry,
      endTime: this.endTime,
      error: this.error
        ? {
            message: this.error.message,
            type: this.error.type,
          }
        : undefined,
      llmContent: this.llmContent,
      startTime: this.startTime,
      status: this.status,
    };
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

  const result: [string, string, { [key: string]: string }][] = [];

  commandArray.forEach((command) => {
    const [node, filename, ...args] = command;
    const params: { [key: string]: string } = {};
    let key = "";
    args.forEach((arg) => {
      if (arg.startsWith("-")) {
        // 支持 -v 或 --option 格式，移除前面的 - 或 --
        key = arg.replace(/^--?/, "");
      } else if (key) {
        // 当前面有key时，当前值作为参数值
        params[key] = arg;
        key = ""; // 重置key，准备接收下一个参数
      }
    });

    result.push([node, filename, params]);
  });

  return result;
}
