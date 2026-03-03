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
    };

/** 追加的命令格式（用于 execute 返回值中的 appendCommands） */
interface AppendCommand {
  /** 工具名称，必须在当前 tools 列表中存在 */
  toolName: string;
  /** 工具参数，可选 */
  params?: Record<string, string>;
}

/** execute / stream 的第二个参数，提供错误类等上下文，后续可扩展 */
interface ExecuteContext {
  ToolRetryError: new (
    params:
      | {
          llmContent: string;
          displayContent: string;
          autoRetry?: boolean;
          appendRetryMessage?: boolean;
          maxRetries?: number;
        }
      | string,
  ) => Error;
  RetryError: new (
    message: unknown,
    options?: { display?: string; maxRetries?: number },
  ) => Error;
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
    | ((ctx: {
        params?: { [key: string]: string };
        hasAttachments: boolean;
      }) => AiRole);
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
  ) => ToolExecuteResult;
  stream?: (
    params: {
      files: Files;
      status: "start" | "ing" | "complete";
      replaceContent: string;
      /** 当前完整响应 */
      content: string;
    },
    context?: ExecuteContext,
  ) => void | string;
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
