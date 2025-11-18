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
}

interface RxaiOptions {
  request: RequestOptions;
}

class Rxai extends BaseAgent {
  private cacheMessages: PlanningAgent[] = [];
  private cacheIndex: number = 0;

  // 场景
  scenes: Record<string, RegisterParams> = {};

  // TODO: 临时。不允许同时发起多个请求
  inProgress = false;

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
    if (this.inProgress) {
      return;
    }
    const { message, emits, key, attachments, presetMessages } = params;
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
      historyMessages: this.cacheMessages.reduce((pre, cur) => {
        pre.push(...cur.getMessages());
        return pre;
      }, [] as ChatMessages),
      attachments,
      presetMessages: presetMessages || [],
    });

    this.cacheMessages[index] = planningAgent;

    this.planCallback(this.cacheMessages);

    try {
      this.inProgress = true;
      await planningAgent.run();
      this.inProgress = false;
    } catch {
      this.inProgress = false;
    }
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
