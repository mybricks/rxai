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
  presetMessages?: ChatMessages;
  tools: Tool[];
}

interface RxaiOptions {
  request: RequestOptions;
}

class Rxai extends BaseAgent {
  private cacheMessages: PlanningAgent[] = [];
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
    const { message, emits, key, attachments, presetMessages, tools } = params;
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      requestInstance: this.requestInstance,
      tools:
        tools ||
        Object.entries(this.scenes).reduce((pre, [, value]) => {
          pre.push(...value.tools);
          return pre;
        }, [] as Tool[]),
      system: this.system,
      emits,
      key,
      message,
      historyMessages: this.cacheMessages.reduce((pre, cur) => {
        pre.push(...cur.getMessages());
        return pre;
      }, [] as ChatMessages),
      attachments,
      presetMessages: presetMessages || [],
    });

    this.cacheMessages[index] = planningAgent;

    this.planCallback(this.cacheMessages);

    await planningAgent.run();
  }

  getMessages() {
    return this.cacheMessages;
  }

  private planCallback = (value: any) => {};

  onPlanCallback = (fn: any) => {
    fn(this.cacheMessages);
    this.planCallback = fn;
  };

  offPlanCallback = () => {
    this.planCallback = () => {};
  };
}

export { Rxai, RegisterParams, RequestParams };
