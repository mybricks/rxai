import { BaseAgent } from "../agentnext/base";
import { PlanningAgent } from "../agentnext/planning";
import { ApiRequestClient } from "../requestnext";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  message: string | ChatMessages[0];
  emits: Emits;
  key: string;
}

class Rxai extends BaseAgent {
  private cacheMessages: ChatMessages[] = [];
  private cacheIndex: number = 0;
  // 场景
  scenes: Record<string, RegisterParams> = {};

  constructor() {
    super({
      system: { title: "MyBricks" },
    });
  }

  register(params: RegisterParams) {
    this.scenes[params.name] = params;
  }

  async requestAI(params: RequestParams) {
    const { message, emits, key } = params;
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      request: new ApiRequestClient(),
      tools: Object.entries(this.scenes).reduce((pre, [, value]) => {
        pre.push(...value.tools);
        return pre;
      }, [] as Tool[]),
      system: this.system,
      emits,
      key,
    });

    await planningAgent.run(message);

    this.cacheMessages[index] = planningAgent.getMessages();
  }
}

export { Rxai, RegisterParams, RequestParams };
