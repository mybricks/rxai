import { OpenAI } from "openai";

export interface RxToolContext {
  /** 读取上下文 */
  read(filename: string): string;
  /** 写入上下文 */
  write(filename: string, data: string): void;
  error(error: Error): void
  /** 将内容作为大模型的返回值注入到当轮问答 */
  // message(message: string): void
}

export interface StreamDelta {
  text: string
}

export abstract class Tool {
  name: string;
  description: string;
  version: string

  private _systemPrompt: string | (() => string);
  private isStreaming: boolean = false
  private streamContent: string = ''

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
    this.version = version ?? '1.0.0';
  }

  public get systemPrompt() {
    return typeof this._systemPrompt === 'function' ? this._systemPrompt() : this._systemPrompt;
  }

  streamStart(): void {
    this.isStreaming = true;
    this.streamContent = '';
  }

  streamError(error: Error, context: RxToolContext): void {
    this.streamEnd?.(undefined, context);
    context?.error(error);
  }

  streaming(delta: StreamDelta, context: RxToolContext): void {
    this.streamContent += delta.text
    this.onStreaming?.(delta, this.streamContent, context)
  }

  streamEnd(_: any, context: RxToolContext) : string {
    this.isStreaming = false
    return this.onStreamEnd?.(this.streamContent, context)
  }

  abstract onStreaming(delta: StreamDelta, content: string, context: RxToolContext): void;

  abstract onStreamEnd(content: string, context: RxToolContext): string;
}

export abstract class BaseTool {
  name: string;
  description: string;
  parameters: object;
  constructor(name: string, description: string, parameters: object) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
  }

  abstract execute(args: unknown): Promise<string>;

  toParam(): OpenAI.Chat.Completions.ChatCompletionTool {
    const paramsSchema = { ...this.parameters, additionalProperties: false };
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: paramsSchema,
      },
    };
  }
}

export class ToolCollection {
  tools: BaseTool[];
  toolMap: { [name: string]: BaseTool };

  constructor(tools: BaseTool[]) {
    this.tools = tools;
    this.toolMap = {};
    for (const tool of tools) {
      this.toolMap[tool.name] = tool;
    }
  }

  toParams(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this.tools.map((t) => t.toParam());
  }

  async execute(name: string, toolInput: object): Promise<string> {
    const tool = this.toolMap[name];
    if (!tool) {
      throw new Error(`Tool '${name}' is invalid`);
    }
    const result = await tool.execute(toolInput);
    return result;
  }
}
