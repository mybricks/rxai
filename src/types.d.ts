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
  aiRole?: "image" | "architect" | "expert";
  execute: (params?: {
    files: Files;
    content: string;
  }) => string | { displayContent: string; llmContent: string };
  stream?: (params: {
    files: Files;
    status: "start" | "ing" | "complete";
  }) => void;
  streamThoughts?: boolean;
  /** TODO: 当配置该字段，且是最后一个工具时，再发起一次请求 */
  lastAppendMessage?: string;
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

/** AI角色定义 */
type AiRole = "plan" | "image" | "architect" | "expert";
