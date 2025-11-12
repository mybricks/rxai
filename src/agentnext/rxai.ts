import { BaseAgent } from "../agentnext/base";
import { PlanningAgent } from "../agentnext/planning";
import { ApiRequestClient } from "../requestnext";
import { getMode } from "../storage/getMode";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  message: string;
  emits: Emits;
  key: string;
  attachments: Attachment[];
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
    const { message, emits, key, attachments } = params;
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      request: new ApiRequestClient({ mode: getMode() }),
      tools: Object.entries(this.scenes).reduce((pre, [, value]) => {
        pre.push(...value.tools);
        return pre;
      }, [] as Tool[]),
      system: this.system,
      emits,
      key,
      message,
      attachments,
    });

    await planningAgent.run();

    this.cacheMessages[index] = planningAgent.getMessages();
  }
}

export { Rxai, RegisterParams, RequestParams };
