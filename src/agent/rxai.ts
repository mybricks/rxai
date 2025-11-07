import { Tool } from "../tool/base";
import { BaseAgent } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, ApiRequestClient } from "../request";

interface RxaiOptions {
  request: Request;
  tools?: (() => Tool)[];
  system?: System;
}

interface System {
  title: string;
}

class Rxai extends BaseAgent {
  private request: Request;
  private cacheMessages: ChatMessages[] = [];
  private cacheIndex: number = 0;
  private tools: (() => Tool)[];
  constructor(options: RxaiOptions) {
    super({
      system: options.system || { title: "MyBricks" },
    });
    this.request = options.request;
    this.tools = options.tools || [];
  }

  async requestAI(
    content: string | { role: "user"; content: unknown },
    emits: Emits,
  ) {
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      request: new ApiRequestClient(this.request),
      tools: this.tools.map((tool) => tool()),
      system: this.system,
      emits,
    });

    await planningAgent.execute(content);

    this.cacheMessages[index] = planningAgent.getMessages();
  }
}

export { Rxai };
