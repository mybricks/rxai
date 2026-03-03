/* eslint-disable @typescript-eslint/ban-ts-comment */
import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";
import { Events } from "../utils/events";
import { Request } from "../request/request";
import { IDB } from "../utils/idb";
import { uuid } from "../utils/uuid";
import {
  RxaiError,
  RequestError,
  ToolRetryError,
  RetryError,
  createExecuteContext,
  type ExecuteContext,
} from "../error/base";
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
  /** 历史记录模式：aggregated=单条聚合，expanded=按轮次展开为 user/assistant 对 */
  historyMessageMode?: "aggregated" | "expanded";
  presetMessages:
    | ChatMessages
    | (() => ChatMessages)
    | (() => Promise<ChatMessages>);
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
  /** 追加命令的最大深度，防止循环追加；不传则使用默认值 */
  maxAppendDepth?: number;
}

type PlanStatus = "pending" | "success" | "error" | "aborted";

/** 没有response */
const CATCH_EMPTY = Symbol("CATCH_EMPTY");

type PlanError = RequestError | ToolRetryError | RetryError | null;

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

  /** 格式化后的用户输入文本（仅用户原文经 formatUserMessage 后的结果，不含规划/进度），历史构建时优先使用 */
  private formattedUserMessageText: string | null = null;

  private defaultPlanList = false;

  /** 追加命令的最大深度（默认 5），防止循环追加 */
  private static readonly DEFAULT_MAX_APPEND_DEPTH = 5;
  private readonly maxAppendDepth: number;
  /** 当前追加深度 */
  private appendDepth: number = 0;

  constructor(private options: PlanningAgentOptions) {
    super(options);
    this.maxAppendDepth =
      options.maxAppendDepth ?? PlanningAgent.DEFAULT_MAX_APPEND_DEPTH;
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

      // 初始化 formattedUserMessageText（planList 场景也需要）
      if (typeof options.formatUserMessage === "function") {
        const userMsg = this.getUserMessage();
        const formatted = this.formatUserMessage(
          userMsg,
          options.formatUserMessage,
        );
        const text =
          typeof formatted?.content === "string"
            ? formatted.content
            : Array.isArray(formatted?.content)
              ? (formatted.content as { type: string; text?: string }[]).find(
                  (item) => item.type === "text",
                )?.text
              : undefined;
        this.formattedUserMessageText =
          (typeof text === "string" ? text : null) ?? options.message;
      } else {
        this.formattedUserMessageText = options.message;
      }
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

      await this.tryCatch(async () => {
        try {
          return await this.planning();
        } catch (e) {
          // RetryError 用自身的 maxRetries；进入 catch 已执行 1 次，故传 maxRetries-1
          if (e instanceof RetryError && e.maxRetries > 0) {
            return await retry(
              () => this.planning(),
              Math.max(0, e.maxRetries - 1),
              (x) => x instanceof RetryError,
            );
          }
          // RequestError 用 requestInstance.maxRetries
          if (e instanceof RequestError) {
            return await retry(
              () => this.planning(),
              Math.max(0, this.options.requestInstance.maxRetries - 1),
              (x) => x instanceof RequestError,
            );
          }
          throw e;
        }
      }, true);

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
      messages: await this.getLLMMessages({
        start: [
          {
            role: "system",
            content: getSystemPrompt({
              title: "MyBricks.ai",
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

    if (
      planningResponse instanceof RequestError ||
      planningResponse instanceof ToolRetryError ||
      planningResponse instanceof RetryError
    ) {
      // 规划出错
      return;
    }

    this.setLlmContent(planningResponse);

    // 规划响应中不应出现历史摘要格式，出现则说明 LLM 误将上下文中的摘要当作输出格式
    if (planningResponse.includes("<历史记录-摘要")) {
      throw new RetryError(
        "返回结果包含历史记录摘要格式，请勿模仿摘要的格式输出，重新按要求规划并输出。",
      );
    }

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
          throw new RequestError("规划结果不符合预期");
        }
        bashCommands = check;
      }

      this.validateBashCommandTools(bashCommands);

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

  /**
   * 校验 bash 命令中的工具名是否均已注册，
   * 若存在非法工具名则抛出 RequestError，触发全局重试并将错误消息带给下一轮 LLM。
   */
  private validateBashCommandTools(
    bashCommands: [string, string, Record<string, string>][],
  ) {
    const registeredNames = new Set(this.options.tools.map((t) => t.name));
    const invalidNames = bashCommands
      .map((argv) => argv[1])
      .filter((name) => !registeredNames.has(name));

    if (invalidNames.length > 0) {
      const available = Array.from(registeredNames).join("、");
      throw new RetryError(
        `以下工具名未注册或不可用，请仅使用已列出的工具重新规划：${invalidNames.join("、")}。可用工具：${available}`,
      );
    }
  }

  /** 执行规划的脚本 */
  private async executeCommands() {
    if (!this.commands.length) {
      return;
    }

    let index = this.commands.findIndex(
      (command) => command.status !== "success",
    );
    if (index === -1) {
      return;
    }

    while (index < this.commands.length && this.status === "pending") {
      const command = this.commands[index];

      command.status = "pending";
      command.startTime = new Date().getTime();

      this.setCommands(this.commands, false);

      const [error, response] = await this.tryCatch(async () => {
        try {
          return await this.executeCommand(command);
        } catch (e) {
          // 统一处理：根据错误类型决定重试策略
          if (e instanceof ToolRetryError && e.autoRetry && e.maxRetries > 0) {
            // 先把当前错误信息写入步骤 content，与手动重试时一致，再自动重试
            const currentForRetry = this.commands[index];
            Object.assign(currentForRetry.content, {
              llm: e.getLlmContentWithRetryMessage(),
              display: e.displayContent,
            });
            this.setCommands(this.commands, false);
            // 进入 catch 时已执行过 1 次，retry() 内部会再执行 (count+1) 次，故传 maxRetries-1 才能保证「1 次初始 + maxRetries 次重试」
            return await retry(
              () => this.executeCommand(command),
              Math.max(0, e.maxRetries - 1),
              (x) => x instanceof ToolRetryError,
            );
          }
          if (e instanceof RequestError) {
            const retries = e.maxRetries ?? this.requestInstance.maxRetries;
            if (retries > 0) {
              return await retry(
                () => this.executeCommand(command),
                Math.max(0, retries - 1),
                (x) => x instanceof RequestError,
              );
            }
          }
          throw e;
        }
      }, true);

      // executeCommand 内可能调用了 handleAppendCommands -> setCommands，会替换 this.commands，必须重新取当前项
      const current = this.commands[index];

      if (response === CATCH_EMPTY) {
        this.setLoading(false);
        current.status = "error";
        // 统一错误内容设置
        if (
          error instanceof ToolRetryError ||
          error instanceof RequestError ||
          error instanceof RetryError
        ) {
          Object.assign(current.content, {
            llm:
              error instanceof ToolRetryError
                ? error.getLlmContentWithRetryMessage()
                : error.llmContent,
            display: error.displayContent,
          });
        } else if (error instanceof Error) {
          const message = error.message;
          Object.assign(current.content, {
            llm: message,
            display: message,
          });
        } else {
          const message = "工具调用错误";
          Object.assign(current.content, {
            llm: message,
            display: message,
          });
        }
        this.setCommands(this.commands, false);
        this.setError(error);
      } else {
        current.status = "success";
        Object.assign(current.content, response);
        this.setCommands(this.commands, true);
      }

      current.endTime = new Date().getTime();

      if (this.status === "pending") {
        index++;
        if (index === this.commands.length) {
          this.setStatus("success");
        }
      }
    }
  }

  /**
   * 处理工具返回的追加命令，追加到执行队列末尾
   * @param appendCommands 要追加的命令列表
   * @returns 是否成功追加
   */
  private handleAppendCommands(appendCommands?: AppendCommand[]): boolean {
    if (!appendCommands?.length) {
      return false;
    }

    if (this.appendDepth >= this.maxAppendDepth) {
      console.warn(
        `[PlanningAgent] 追加深度已达上限 ${this.maxAppendDepth}，忽略后续追加`,
      );
      return false;
    }

    this.appendDepth++;

    const newCommands = appendCommands
      .map((cmd): PlanningAgent["commands"][number] | null => {
        const tool = this.options.tools.find((t) => t.name === cmd.toolName);
        if (!tool) {
          console.warn(
            `[PlanningAgent] 追加的工具 "${cmd.toolName}" 不存在，已忽略`,
          );
          return null;
        }
        return {
          startTime: 0,
          endTime: 0,
          argv: ["node", cmd.toolName, cmd.params || {}],
          status: null,
          tool: {
            name: tool.name,
            displayName: tool.displayName,
          },
          content: {
            llm: "",
            display: "",
            response: "",
          },
          events: new Events(),
        };
      })
      .filter((c): c is PlanningAgent["commands"][number] => c !== null);

    if (!newCommands.length) {
      return false;
    }

    this.commands.push(...newCommands);
    this.setCommands(this.commands, true);
    return true;
  }

  /**
   * 执行工具并规范化返回值（含 appendCommands）
   */
  private async toolExecute(
    tool: Tool,
    params: {
      params?: { [key: string]: string };
      files: Files;
      content: string;
      replaceContent: string;
      getUserMessage?: () => ReturnType<PlanningAgent["getUserMessage"]>;
    },
  ): Promise<{
    llm: string;
    display: string;
    appendCommands?: AppendCommand[];
  }> {
    const context = createExecuteContext();
    const [error, response] = await this.tryCatch(() => {
      if (tool.name === "get-history-records") {
        // @ts-ignore
        this.filenames = (tool.execute as (p: any, c?: ExecuteContext) => any)(
          params,
          context,
        );
        const mode = this.options.historyMessageMode ?? "aggregated";
        const tip =
          mode === "expanded"
            ? `已读取历史对话记录：${(this.filenames as string[]).join(", ")}，后续将基于完整历史上下文继续`
            : "已读取历史对话记录";
        return tip;
      }
      return (tool.execute as (p: any, c?: ExecuteContext) => any)(
        params as any,
        context,
      );
    });

    if (response === CATCH_EMPTY) {
      throw error;
    }

    if (typeof response === "string") {
      return { llm: response, display: response };
    }

    const obj = response as {
      llmContent: string;
      displayContent: string;
      appendCommands?: AppendCommand[];
    };
    return {
      llm: obj.llmContent,
      display: obj.displayContent,
      appendCommands: obj.appendCommands,
    };
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

    if (!toolPrompt) {
      const result = await this.toolExecute(tool, {
        params,
        files: [] as unknown as Files,
        content: "",
        replaceContent: "",
        getUserMessage: () => this.getUserMessage(),
      });
      const { appendCommands, ...contentData } = result;
      Object.assign(content, contentData);
      this.handleAppendCommands(appendCommands);
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
              const execContext = createExecuteContext();
              const res = tool.stream!(
                {
                  files,
                  status,
                  replaceContent,
                  content,
                },
                execContext,
              );
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

      // 执行 before 钩子
      if (tool.hooks?.before && typeof tool.hooks.before === "function") {
        await tool.hooks.before({
          params,
        });
      }

      const historyMessages = this.getHistoryMessages(this.filenames);
      const llmMessages = await this.getLLMMessages({
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
          ...historyMessages,
        ],
      });

      // 检查是否有附件：当前请求的附件 + 历史记录中带进来的附件
      // 只要 content 是数组结构就说明包含了附件
      const hasHistoryAttachments = historyMessages.some((msg) => {
        return Array.isArray(msg.content);
      });

      const hasAttachments = !!(
        this.options.attachments?.length || hasHistoryAttachments
      );

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
            ? (tool.aiRole as any)?.({ params, hasAttachments })
            : tool.aiRole,
      });

      if (streamError) {
        throw streamError;
      }

      if (
        response instanceof RequestError ||
        response instanceof ToolRetryError ||
        response instanceof RetryError
      ) {
        throw response;
      }

      // 解析文件
      const { files, content: replaceContent } = parseFileBlocks(response);

      const result = await this.toolExecute(tool, {
        params,
        files,
        content: response,
        replaceContent,
        getUserMessage: () => this.getUserMessage(),
      });
      const { appendCommands, ...contentData } = result;
      Object.assign(content, contentData, { response });
      this.handleAppendCommands(appendCommands);
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
  private async getLLMMessages(params: {
    start?: ChatMessages;
    end?: ChatMessages;
  }) {
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

    // 存储格式化后的用户输入（仅第一次，供历史构建时优先使用）
    if (this.formattedUserMessageText === null) {
      const rawFormattedText =
        typeof userMessage?.content === "string"
          ? userMessage.content
          : Array.isArray(userMessage?.content)
            ? (userMessage.content as { type: string; text?: string }[]).find(
                (item) => item.type === "text",
              )?.text
            : undefined;
      this.formattedUserMessageText =
        (typeof rawFormattedText === "string" ? rawFormattedText : null) ??
        options.message;
      this.idbPubContent(
        "formattedUserMessageText",
        this.formattedUserMessageText,
      );
    }

    // 历史上下文中含有 <历史记录-摘要> 格式，提醒 LLM 不要模仿
    userMessage = this.formatUserMessage(
      userMessage,
      (msg) =>
        msg +
        "\n\n[注意] 历史消息中可能包含 <历史记录-摘要> 格式的摘要内容，这个内容已经不是原始输出，禁止模仿此格式输出。",
    );

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
        const statusMap: Record<string, string> = {
          success: "[已完成]",
          pending: "[正在执行]",
          error: "[执行失败]",
        };
        const status = statusMap[command.status] ?? "[待执行]";
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
          case "pending": {
            progressContent += `\n\n[正在执行] ${commandStr}`;
            const pendingOutput =
              command.content.llm || command.content.display;
            if (pendingOutput) {
              progressContent += `\n----- 输出内容 -----\n${pendingOutput}\n----- 输出内容 -----`;
              progressContent += `\n执行时出错，请分析错误原因，修正上述命令或重新规划。`;
            } else if (this.error instanceof ToolRetryError) {
              progressContent += `\n执行时出错: ${this.error.message}\n请分析错误原因，修正上述命令或重新规划。`;
            } else {
              progressContent +=
                "\n请根据工具描述、用户消息、以及前置工具的执行结果，为当前步骤提供输出。";
            }
            break;
          }
          case "error": {
            progressContent += `\n\n[执行失败] ${commandStr}`;
            const errOutput = command.content.llm || command.content.display;
            progressContent += `\n----- 输出内容 -----\n${errOutput || "工具调用错误"}\n----- 输出内容 -----`;
            break;
          }
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

    // 附加重试错误信息，供重试轮把错误原因带给 LLM
    const retryMessage: ChatMessages = [];
    if (this.error instanceof RetryError) {
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
    const presetMsgs =
      typeof options.presetMessages === "function"
        ? await options.presetMessages()
        : options.presetMessages;
    const messages = [
      ...presetMsgs,
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
    this.setLoading(false);
    this.setStatus("error");
    if (
      error instanceof RequestError ||
      error instanceof ToolRetryError ||
      error instanceof RetryError
    ) {
      this.error = error;
    } else {
      // 默认为ToolRetryError
      this.error = new ToolRetryError(
        (error as Error)?.message || "工具调用错误",
      );
    }

    this.idbPubContent("error", this.error.toJSON());

    this.events.emit("error", this.error.displayContent);
  }

  /** 设置状态 */
  private setStatus(status: PlanningAgent["status"]) {
    this.status = status;
    this.idbPubContent("status", status);
    this.events.emit("status", status);
  }

  /** TODO: 获取DB存储的plan静态数据 */
  async getDBContent() {
    const { options } = this;
    const presetMsgs =
      typeof options.presetMessages === "function"
        ? await options.presetMessages()
        : options.presetMessages;
    return {
      uuid: this.uuid,
      extension: options.extension,
      enableLog: options.enableLog,
      attachments: options.attachments,
      message: options.message,
      presetHistoryMessages: options.presetHistoryMessages,
      presetMessages: presetMsgs,
      planList: options.planList,
      blockId: options.blockId,
    };
  }

  /** TODO: 从DB恢复 */
  recover(params: any) {
    this.enableRetry = false;
    params.forEach(({ type, content }: any) => {
      if (type === "formattedUserMessageText" && content != null) {
        this.formattedUserMessageText = content;
        return;
      }
      if (type === "error") {
        if (content) {
          // 使用 RxaiError 工厂兼容旧数据
          this.error = RxaiError(
            content.message,
            content.type,
            content.display || content.displayContent,
          );
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
      this.events.emit("error", this.error.displayContent);
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
  getMessages(): {
    message: string;
    userMessageText: string;
    summaryMessage: string;
    attachments?: Attachment[];
  } | null {
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
    const userMessageText: string =
      this.formattedUserMessageText ?? this.options.message;
    message += "\n\n### 用户消息" + `\n${userMessageText}`;

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
      userMessageText,
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

  async export() {
    const { options } = this;
    const presetMsgs =
      typeof options.presetMessages === "function"
        ? await options.presetMessages()
        : options.presetMessages;
    return {
      uuid: this.uuid,
      options: {
        attachments: options.attachments,
        extension: options.extension,
        message: options.message,
        presetHistoryMessages: options.presetHistoryMessages,
        presetMessages: presetMsgs,
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
      formattedUserMessageText: this.formattedUserMessageText,
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
            content: `你正在为后续对话生成一份「可延续对话摘要」。目标是让另一个 agent 读完这份摘要后，能无缝接手并继续当前工作。

请基于下方对话历史，严格按照以下模板输出（保留二级标题与结构，只填写各节内容）：

---
## Goal

[用户想要达成的目标是什么？用 1～2 句话说明。]

## Instructions

- [用户给出的、与任务相关的重要指示]
- [若有计划或规格说明，简要概括，便于下一 agent 按此继续]

## Discoveries

[对话过程中发现的重要信息、结论或约束，对后续 agent 继续工作有帮助的内容]

## Accomplished

[已完成的工作、进行中的工作、以及尚未完成/待办的工作]

## Relevant files / directories

[与任务相关的文件或目录列表：已读、已编辑或已创建的文件；若某目录下文件都相关，可只写目录路径。保持结构化、便于查找。]
---

要求：
1. 信息完整、准确，便于下一 agent 理解上下文并继续执行。
2. 语言精炼，避免重复；Relevant files 尽量列出真实路径或文件名。
3. 直接输出上述模板的填写结果，不要额外解释或包裹在代码块中。`,
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
    this.error = new ToolRetryError("已销毁");
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
