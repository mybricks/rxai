import OpenAI from "openai";
import { LLM } from "../llm";
import { ToolCollection } from "../tool/base";
import { SYSTEM_PROMPT } from "../prompt/rxai";

enum AgentState {
  RUNNING = "RUNNING",
  FINISHED = "FINISHED",
}

interface BaseAgentConfig {
  llm: LLM;
  tools: ToolCollection;
}

abstract class BaseAgent {
  protected llm: LLM;
  protected tools: ToolCollection;
  state: AgentState = AgentState.FINISHED;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
  ];

  constructor(config: BaseAgentConfig) {
    this.llm = config.llm;
    this.tools = config.tools;
  }

  abstract step(): Promise<string>;

  async run(content: string) {
    this.messages.push({
      role: "user",
      content,
    });

    try {
      this.state = AgentState.RUNNING;

      while (this.state === AgentState.RUNNING) {
        await this.step();
      }
    } catch (error) {
      console.log("[error]", error);
    } finally {
      if (this.state === AgentState.FINISHED) {
        console.log("正常结束调用");
      }
    }
  }
}

export { BaseAgent, AgentState, BaseAgentConfig };
