export interface RxToolContext {
  /** 读取上下文 */
  read(filename: string): string;
  /** 写入上下文 */
  write(filename: string, data: string): void;
  error(error: Error): void;
  /** 将内容作为大模型的返回值注入到当轮问答 */
  // message(message: string): void
}

export interface StreamDelta {
  text: string;
}

export abstract class Tool {
  name: string;
  description: string;
  version: string;

  private _systemPrompt: string | (() => string);
  private isStreaming: boolean = false;
  private streamContent: string = "";

  constructor({
    name,
    description,
    systemPrompt,
    version,
  }: {
    name: string;
    description: string;
    systemPrompt: string | (() => string);
    version: string;
  }) {
    this.name = name;
    this.description = description;
    this._systemPrompt = systemPrompt;
    this.version = version ?? "1.0.0";
  }

  public get systemPrompt() {
    return typeof this._systemPrompt === "function"
      ? this._systemPrompt()
      : this._systemPrompt;
  }

  streamStart(): void {
    this.isStreaming = true;
    this.streamContent = "";
  }

  streamError(error: Error, context: RxToolContext): void {
    this.streamEnd?.(undefined, context);
    context?.error(error);
  }

  streaming(delta: StreamDelta, context: RxToolContext): void {
    this.streamContent += delta.text;
    this.onStreaming?.(delta, this.streamContent, context);
  }

  streamEnd(_: any, context: RxToolContext): string {
    this.isStreaming = false;
    return this.onStreamEnd?.(this.streamContent, context);
  }

  /** 当流式传输开始时 */
  onStreamStart() {}

  /** 当正在流式传输时 */
  onStreaming(delta: StreamDelta, content: string, context: RxToolContext) {}

  /** 流式传输结束时 */
  onStreamEnd(content: string, context: RxToolContext) {
    return content;
  }
}
