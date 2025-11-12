type ChatMessages = {
  role: string;
  content: unknown;
}[];

interface Emits {
  write: (chunk: string) => void;
  complete: (content: string) => void;
  error: (e: Error) => void;
  cancel: (cb: () => void) => void;
}

interface Tool {
  name: string;
  description: string;
  getPrompts: (params: { attachments: Attachment[] }) => string;
  aiRole?: "image" | "architect" | "expert";
  execute: (params: { files: any[]; key: string }) => string;
}

type Mode = "production" | "development";

interface Attachment {
  type: "image";
  content: string;
  title?: string;
  size?: number;
}
