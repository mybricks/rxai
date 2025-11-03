import { OpenAI } from "openai";

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
