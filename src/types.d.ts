/** 消息列表 */
type ChatMessages = {
  role: string;
  content: unknown;
}[];

/** 流式请求回调接口 */
interface Emits {
  write: (chunk: string) => void;
  complete: (content: string) => void;
  error: (e: string) => void;
  cancel: (cb: () => void) => void;
}

/** 工具execute所需的文件列表 */
type Files = {
  fileName: string;
  name: string;
  extension: string;
  language: string;
  content: string;
  isComplete: boolean;
}[];

/** 工具 execute 的返回类型 */
type ToolExecuteResult =
  | string
  | {
      displayContent: string;
      llmContent: string;
      /** 追加的工具调用列表，会在当前工具执行完后按顺序追加到执行队列末尾 */
      appendCommands?: AppendCommand[];
      /**
       * 历史记录文件名列表（仅 get-history-records 工具使用）。
       * agent 内部会读取此字段来设置 filenames。
       */
      fileNames?: string[];
    };

/** 追加的命令格式（用于 execute 返回值中的 appendCommands） */
interface AppendCommand {
  /** 工具名称，必须在当前 tools 列表中存在 */
  toolName: string;
  /** 工具参数，可选 */
  params?: Record<string, string>;
}

/** 附件的统一描述（用于 ExecuteContext.attachments） */
interface AttachmentInfo {
  type: "image" | string;
  /** 内容格式：base64（data URI）或外部 url */
  format: "base64" | "url";
  /** 来源：current = 本轮请求，history = 历史记录 */
  scope: "current" | "history";
  title?: string;
  size?: number;
}

/** execute / stream 的第二个参数，提供错误类等上下文，后续可扩展 */
interface ExecuteContext {
  ToolRetryError: new (
    params:
      | {
          llmContent: string;
          displayContent: string;
          autoRetry?: boolean;
          maxRetries?: number;
        }
      | string,
  ) => Error;
  RetryError: new (
    message: unknown,
    options?: { display?: string; maxRetries?: number },
  ) => Error;
  /** 当前工具在 commands 执行队列中的步骤索引 */
  currentIndex: number;
  /**
   * 当前执行计划的命令列表（只读快照）。
   * 配合 currentIndex 可判断当前是否为最后一个步骤：
   * `currentIndex === commands.length - 1`
   */
  commands: ReadonlyArray<{ name: string; params?: Record<string, string> }>;
  /** 当前是第几次重试（0 = 首次执行，1 = 第一次重试，以此类推） */
  retryCount: number;
  /** 当前上下文中的所有附件（含来源信息） */
  attachments: AttachmentInfo[];
}

/** 工具 */
interface Tool {
  name: string;
  description: string;
  displayName: string;
  getPrompts?: (params: { attachments?: Attachment[] }) => string;
  /** 工具对应的 AI 角色 */
  aiRole?:
    | AiRole
    | ((
        ctx: {
          params?: { [key: string]: string };
        },
        execCtx: ExecuteContext,
      ) => AiRole);
  /**
   * 执行工具
   * @param params 执行参数
   * @param context 上下文（含 ToolRetryError、RetryError 等），供工具内按需抛出，后续可扩展
   * @returns 字符串或包含 displayContent/llmContent 的对象；对象中可选 appendCommands 用于追加后续工具
   */
  execute: (
    params: {
      files: Files;
      content: string;
      params?: { [key: string]: string };
      replaceContent: string;
      /** 当前轮用户消息，便于工具内获取用户原始输入 */
      userMessage?: { role: string; content: unknown };
    },
    context?: ExecuteContext,
  ) => ToolExecuteResult | Promise<ToolExecuteResult>;
  stream?: (
    params: {
      files: Files;
      status: "start" | "ing" | "complete";
      replaceContent: string;
      /** 当前完整响应 */
      content: string;
    },
    context?: ExecuteContext,
  ) => void | string | Promise<void | string>;
  streamThoughts?: boolean;
  hooks?: {
    /** 工具执行前钩子 */
    before?: (ctx: {
      params?: { [key: string]: string };
    }) => void | Promise<void>;
  };
}

/** TODO: 环境？可以去除 */
type Mode = "production" | "development";

/** 附件，目前只支持image */
interface Attachment {
  type: "image";
  content: string;
  title?: string;
  size?: number;
}

/**
 * AI 角色定义（按能力从轻到重）
 */
type AiRole = "plan" | "image" | "junior" | "expert" | "architect";
