type ChatMessages = {
  role: string;
  content: unknown;
}[];
type Step = { name: string; done: boolean };
interface Emits {
  write: (chunk: string) => void;
  complete: () => void;
  error: (e: Error) => void;
  cancel: (cb: () => void) => void;
}
