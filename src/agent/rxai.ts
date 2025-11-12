import { BaseAgent } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, RequestOptions } from "../request/request";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  message: string;
  emits: Emits;
  key: string;
  attachments?: Attachment[];
}

interface RxaiOptions {
  request: RequestOptions;
}

class Rxai extends BaseAgent {
  private cacheMessages: ChatMessages[] = [];
  private cacheIndex: number = 0;

  // 场景
  scenes: Record<string, RegisterParams> = {};

  constructor(options: RxaiOptions) {
    super({
      ...options,
      requestInstance: new Request(options.request),
    });
  }

  register(params: RegisterParams) {
    this.scenes[params.name] = params;
  }

  async requestAI(params: RequestParams) {
    const { message, emits, key, attachments } = params;
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      requestInstance: this.requestInstance,
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
