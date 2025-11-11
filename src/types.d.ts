type ChatMessages = {
  role: string;
  content: unknown;
}[];

type Step = { name: string; done: boolean };

interface Emits {
  write: (chunk: string) => void;
  complete: (content: string) => void;
  error: (e: Error) => void;
  cancel: (cb: () => void) => void;
}

interface Tool {
  name: string;
  description: string;
  getPrompts: () => string;
  aiRole?: "image" | "architect" | "expert";
  execute: (params: { files: any[]; key: string }) => string;
}
