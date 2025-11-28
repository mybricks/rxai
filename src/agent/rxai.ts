import { BaseAgent } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, RequestOptions } from "../request/request";
import { Events } from "../utils/events";

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
  presetHistoryMessages?: ChatMessages;
  tools: Tool[];
  planList?: string[];
  enableLog?: boolean;
  extension?: unknown;
}

interface RxaiOptions {
  request: RequestOptions;
  enableLog?: boolean;
}

class Rxai extends BaseAgent {
  private cacheMessages: PlanningAgent[] = [];
  private cacheIndex: number = 0;

  events = new Events<{
    plan: PlanningAgent[];
  }>();

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
    const {
      message,
      emits,
      key,
      attachments,
      presetMessages,
      presetHistoryMessages,
      tools,
      planList,
      enableLog,
      extension,
    } = params;
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
      presetHistoryMessages: presetHistoryMessages || [],
      planList,
      enableLog: typeof enableLog === "boolean" ? enableLog : this.enableLog,
      extension,
    });

    this.cacheMessages[index] = planningAgent;

    this.events.emit("plan", this.cacheMessages);

    await planningAgent.run();
  }
}

export { Rxai, RegisterParams, RequestParams };
