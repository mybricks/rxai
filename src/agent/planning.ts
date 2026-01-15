/* eslint-disable @typescript-eslint/ban-ts-comment */
import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";
import { Events } from "../utils/events";
import { Request } from "../request/request";
import { IDB } from "../utils/idb";
import { uuid } from "../utils/uuid";
import { RxaiError } from "../error/base";
import { retry } from "../utils/retry";

// 是否将 guidePrompt 注入到系统提示词中
const guidePromptInSystemPrompt = true;

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  tools: Tool[];
  message: string;
  blockId?: string;
  attachments?: Attachment[];
  historyMessages: (history: any) => ChatMessages;
  presetMessages: ChatMessages | (() => ChatMessages);
  presetHistoryMessages: ChatMessages;
  formatUserMessage?: (msg: any) => any;
  guidePrompt?: string;
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

type PlanError = RxaiError | null;

type CommandStatus = "pending" | "success" | "error" | null;

type EventsKV = {
  loading: boolean;
  userFriendlyMessages: any[];
  streamMessage: string;
  userMessage: ReturnType<PlanningAgent["getUserMessage"]>;
  startTime: number;
  summary: string;
  commands: PlanningAgent["commands"];
  error: string;
  status: PlanStatus;
  planningMessage: string;
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
  private filenames: string[] = [];

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

  private summaryMessage: string = "";
  /** 当前请求的cancel */
  private currentRequestCancel = () => {};

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
              return error instanceof RxaiError && error.type === "request";
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

    this.summary();
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

  /** 构建用户偏好信息提示词 */
  private buildGuidePromptSection(): string {
    return this.options.guidePrompt
      ? `<用户偏好信息>
关于当前项目，用户提供了他的偏好信息，请注意参考偏好信息来完成任务。
${this.options.guidePrompt}
</用户偏好信息>
`
      : "";
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
    // TODO error类型扩展
    if (this.error?.message === "已销毁") {
      return;
    }
    this.options.idb?.putContent({
      id: this.uuid,
      type,
      content,
    });
  }

  /** 规划 */
  private async planning() {
    const { options } = this;

    const planningStream = getPlanningStream((message) => {
      this.events.emit("planningMessage", message);
    });

    const planningResponse = await this.request({
      messages: this.getLLMMessages({
        start: [
          {
            role: "system",
            content: getSystemPrompt({
              title: this.system.title,
              tools: options.tools,
              prompt: this.system.prompt,
              guidePromptSection: guidePromptInSystemPrompt
                ? this.buildGuidePromptSection()
                : "",
            }),
          },
          ...this.getHistoryMessages(),
        ],
      }),
      emits: this.getEmits({
        write: (chunk) => {
          planningStream(chunk);
        },
      }),
    });

    if (planningResponse instanceof RxaiError) {
      // 规划出错
      return;
    }

    this.setLlmContent(planningResponse);

    let bashCommands = parseBashCommands(planningResponse);

    if (!bashCommands.length) {
      // 说明没有规划
      // this.events.emit("summary", planningResponse);
      this.setStatus("success");
    } else {
      const { planningCheck } = this.options;

      if (planningCheck) {
        const check = planningCheck(bashCommands);
        if (!check) {
          throw new RxaiError("规划结果不符合预期", "request");
        }
        bashCommands = check;
      }

      if (
        bashCommands.length === 1 &&
        bashCommands[0][1] === "get-history-records"
      ) {
        bashCommands.push(["node", "analyse-and-answer", {}]);
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
              return error instanceof RxaiError && error.type === "request";
            },
          ),
        true,
      );

      if (response === CATCH_EMPTY) {
        command.status = "error";
        if (error instanceof RxaiError && error.type === "tool") {
          Object.assign(command.content, {
            llm: error.message,
            display: error.display,
          });
        } else if (
          (error instanceof RxaiError && error.type === "request") ||
          error instanceof Error
        ) {
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
      params,
      guidePromptSection: guidePromptInSystemPrompt
        ? this.buildGuidePromptSection()
        : "",
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
        if (tool.name === "get-history-records") {
          // @ts-ignore
          this.filenames = tool.execute(params);
          return "已读取历史对话记录";
        }
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
      let streamError: any = null;

      const stream = tool.stream
        ? (content: string, status: "start" | "ing" | "complete") => {
            if (streamError) {
              return;
            }
            if (this.status === "error") {
              this.currentRequestCancel?.();
              streamError = this.error;
              return;
            }
            try {
              const { content: replaceContent, files } =
                parseFileBlocks(content);
              const res = tool.stream!({
                files,
                status,
                replaceContent,
              });
              if (typeof res === "string") {
                command.events?.emit("streamMessage", {
                  message: res,
                  status,
                });
              }
            } catch (e) {
              streamError = e;
              this.currentRequestCancel?.();
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
              params,
              guidePromptSection: guidePromptInSystemPrompt
                ? this.buildGuidePromptSection()
                : "",
            }),
          },
          ...this.getHistoryMessages(this.filenames),
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
        aiRole:
          typeof tool.aiRole === "function"
            ? tool.aiRole?.({ params })
            : tool.aiRole,
      });

      if (streamError) {
        throw streamError;
      }

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
        this.currentRequestCancel = fn;
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
    // 辅助函数，用于从 argv 构建命令字符串
    const buildCommandString = (
      argv: [string, string, Record<string, any>],
    ) => {
      const [bash, name, params = {}] = argv;
      return `${name} ${Object.entries(params).reduce(
        (acc, [key, value]) => acc + `-${key} ${value} `,
        "",
      )}`.trim();
    };

    // 获取用户原始需求
    let userMessage =
      typeof options.formatUserMessage === "function"
        ? this.formatUserMessage(
            this.getUserMessage(),
            options.formatUserMessage,
          )
        : this.getUserMessage();

    // 如果存在命令，则构建“工具规划”和“执行进度”
    if (this.commands.length > 0) {
      // 预先找到当前正在执行的命令
      const currentCommand = this.commands.find((c) => c.status === "pending");
      const currentCommandString = currentCommand
        ? buildCommandString(currentCommand.argv)
        : "无";

      // --- 构建“工具规划”部分 ---
      let planningContent = `\n\n---\n## 工具规划`;
      planningContent += `\n为了帮助用户达成上述目的，系统规划了以下工具来处理，当前正在执行 ${currentCommandString}。`;
      for (const command of this.commands) {
        if (command.status === null) continue;
        const statusMap = { success: "[已完成]", pending: "[正在执行]" };
        const status = statusMap[command.status] || "[待执行]";
        planningContent += `\n${status} ${buildCommandString(command.argv)}`;
      }

      // --- 构建“执行进度”部分 ---
      let progressContent = `\n\n## 执行进度`;
      for (const command of this.commands) {
        if (command.status === null) continue;
        const commandStr = buildCommandString(command.argv);
        switch (command.status) {
          case "success": {
            progressContent += `\n\n[已完成] ${commandStr}`;
            const output = command.content.llm || command.content.display;
            progressContent += `\n----- 输出内容 -----\n${output}\n----- 输出内容 -----`;
            break;
          }
          case "pending":
            progressContent += `\n\n[正在执行] ${commandStr}`;
            if (this.error instanceof RxaiError && this.error.type === "tool") {
              progressContent += `\n执行时出错: ${this.error.message}\n请分析错误原因，修正上述命令或重新规划。`;
            } else {
              progressContent +=
                "\n请根据工具描述，以及前置工具的执行结果，为当前步骤提供输出。。";
            }
            break;
          default:
            progressContent += `\n\n[待执行] ${commandStr}`;
            break;
        }
      }
      // 组合所有内容
      userMessage = this.formatUserMessage(
        userMessage,
        (msg) => msg + planningContent + progressContent,
      );
    }

    // 附加重试错误信息
    const retryMessage: ChatMessages = [];
    if (this.error instanceof RxaiError && this.error.type === "retry") {
      retryMessage.push({
        role: "user",
        // @ts-ignore
        content: `[系统提示] 上次规划出错，错误信息: ${this.error.message}。请基于用户需求重新规划。`,
      });
    }

    const guideMessage: ChatMessages = [];
    // 只有当配置为通过用户消息添加时，才添加 guidePrompt
    if (
      !guidePromptInSystemPrompt &&
      this.options?.guidePrompt?.trim &&
      this.options.guidePrompt.trim().length
    ) {
      guideMessage.push({
        role: "user",
        content: this.buildGuidePromptSection(),
      });
    }

    // 组装最终消息列表
    const messages = [
      ...(typeof options.presetMessages === "function"
        ? options.presetMessages()
        : options.presetMessages),
      ...guideMessage,
      userMessage,
      ...retryMessage,
    ];
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
      const error = new RxaiError("已取消执行", "request");
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
      // 默认为ToolError
      this.error = new RxaiError(
        (error as Error)?.message || "工具调用错误",
        "tool",
      );
    }

    this.idbPubContent("error", this.error.toJSON());

    this.events.emit("error", this.error.display);
  }

  /** 设置状态 */
  private setStatus(status: PlanningAgent["status"]) {
    this.status = status;
    this.idbPubContent("status", status);
    this.events.emit("status", status);
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
      blockId: options.blockId,
    };
  }

  /** TODO: 从DB恢复 */
  recover(params: any) {
    this.enableRetry = false;
    params.forEach(({ type, content }: any) => {
      if (type === "error") {
        if (content) {
          this.error = new RxaiError(
            content.message,
            content.type,
            content.display,
          ).recover(content);
        }
      } else {
        // @ts-ignore
        this[type] = content;
      }
    });

    if (this.status === "pending") {
      // 未正常完成，设置为取消状态
      this.setStatus("aborted");
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
      this.events.emit("error", this.error.display);
    } else {
      if (this.status === "aborted") {
        this.events.emit("summary", "已取消");
      } else if (!commands.length) {
        this.events.emit("summary", this.llmContent);
      }
    }

    if (commands.length) {
      const bashIndex = this.llmContent.indexOf("```bash");
      this.events.emit("planningMessage", this.llmContent.slice(0, bashIndex));
    }
  }

  /** 获取扩展参数 */
  get extension() {
    return this.options.extension;
  }

  get blockId() {
    return this.options.blockId;
  }

  /** TODO: 获取当前plan的总结信息 */
  getMessages() {
    if (this.loading || this.status === "pending" || this.messages.length) {
      return null;
    }

    // if (!this.summaryMessage) {
    //   this.summary();
    // }
    let message = "";
    const presetHistoryMessages = this.options.presetHistoryMessages;
    if (presetHistoryMessages?.length) {
      message +=
        "### 系统信息" +
        `${presetHistoryMessages.reduce((pre, cur) => {
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
      (this.status === "error" ? `\nerror：${this.error?.message}` : "");

    return {
      message,
      summaryMessage: this.summaryMessage
        ? `${
            presetHistoryMessages?.length
              ? presetHistoryMessages.reduce((pre, cur) => {
                  return pre + `\n${cur.content}`;
                }, "") + "\n"
              : ""
          }` + this.summaryMessage
        : "",
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
      // TODO error类型扩展
      if (log && this.error?.message !== "已销毁") {
        console.error("[Rxai - planning - error]", e);
      }
      return [e, CATCH_EMPTY];
    }
  }

  async retry() {
    if (this.error instanceof RxaiError && this.error.type === "retry") {
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
      error: this.error ? this.error.toJSON() : undefined,
      llmContent: this.llmContent,
      startTime: this.startTime,
      status: this.status,
      summaryMessage: this.summaryMessage,
    };
  }

  private summaryLoading = false;

  summary() {
    if (this.summaryLoading) {
      return;
    }
    if (this.summaryMessage) {
      return;
    }
    this.summaryLoading = true;
    const historyMessage = this.getMessages();

    if (!historyMessage) {
      return;
    }

    const { message } = historyMessage;

    this.requestInstance
      .requestAsStream({
        messages: [
          {
            role: "system",
            content: `请对以下对话历史记录进行**专业摘要**，提取核心操作与结果，语言精炼，适合存档和快速查阅。

---

**摘要要求：**
1. **用户意图**：用一句话总结用户的原始指令或请求。
2. **关键操作**：列出执行的主要动作（工具调用和重要修改）。
3. **执行结果**：概括任务执行的关键产出或变化。
4. **最终状态**：说明任务完成情况。

---

**输出格式示例：**
\`\`\`
【用户意图】用户希望实现某个具体目标。
【关键操作】调用了工具A和B。
【执行结果】产生了Z变化或达成了W效果。
【最终状态】成功完成/部分完成/失败。
\`\`\`

---

**注意：**
1. 摘要结果必须精简，总字数不超过50字。

---

请根据以上要求，直接给出清晰、简明的摘要结果。`,
          },
          {
            role: "user",
            content: `<对话历史记录>
${message}
</对话历史记录>`,
          },
        ],
        emits: {
          write() {},
          cancel() {},
          error() {},
          complete() {},
        },
      })
      .then((res) => {
        if (res.type === "complete") {
          this.summaryMessage = res.content;
          this.idbPubContent("summaryMessage", res.content);
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        this.summaryLoading = false;
      });

    return {
      message,
      attachments: this.options.attachments,
    };
  }

  getHistoryMessages = (filenames?: string[]) => {
    return this.options.historyMessages(filenames);
  };
  destroy() {
    this.status = "error";
    this.error = new RxaiError("已销毁", "tool");
    this.currentRequestCancel?.();
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

function getPlanningStream(write: (chunk: string) => void) {
  let stopWrite = false;
  let planningMessage = "";
  let temp = "";

  return (chunk: string) => {
    if (stopWrite) {
      return;
    }
    const tempChunk = temp + chunk;
    const backticksIndex = tempChunk.indexOf("`");
    if (temp && tempChunk.length >= 7) {
      if (new RegExp(`^${tempChunk.slice(0, 7)}`).test("```bash")) {
        stopWrite = true;
      } else {
        temp = "";
        planningMessage += tempChunk;
      }
    } else {
      if (backticksIndex !== -1) {
        if (tempChunk.slice(backticksIndex, backticksIndex + 7) === "```bash") {
          stopWrite = true;
          planningMessage += tempChunk.slice(0, backticksIndex);
        } else {
          planningMessage += tempChunk.slice(0, backticksIndex);
          temp = tempChunk.slice(backticksIndex);
        }
      } else {
        planningMessage += chunk;
      }
    }

    const bashIndex = planningMessage.indexOf("```bash");
    if (bashIndex !== -1) {
      stopWrite = true;
      planningMessage = planningMessage.slice(0, bashIndex);
    }

    write(planningMessage);
  };
}
