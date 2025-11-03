import { LLM, LLMConfig } from "../llm";
import { ToolCallAgent } from "./toolcall";
import { BaseTool, ToolCollection } from "../tool/base";

interface RxaiConfig extends LLMConfig {
  tools: Array<BaseTool>;
}

class Rxai extends ToolCallAgent {
  constructor(config: RxaiConfig) {
    super({
      llm: LLM.getInstance("default", config),
      tools: new ToolCollection(config.tools),
    });
  }
}

export { Rxai };
