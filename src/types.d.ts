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
  execute: (params: {
    files: Files;
    content: string;
    params?: { [key: string]: string };
    replaceContent: string;
  }) => string | { displayContent: string; llmContent: string };
  stream?: (params: {
    files: Files;
    status: "start" | "ing" | "complete";
    replaceContent: string;
  }) => void | string;
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
