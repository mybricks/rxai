import { BaseAgent, BaseAgentOptions } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, RequestOptions } from "../request/request";
import { Events } from "../utils/events";
import { IDB } from "../utils/idb";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  message: string;
  emits: Emits;
  key: string;
  attachments?: Attachment[];
  presetMessages?: ChatMessages | (() => ChatMessages);
  presetHistoryMessages?: ChatMessages;
  tools: Tool[];
  planList?: string[];
  enableLog?: boolean;
  extension?: unknown;
}

interface RxaiOptions {
  system?: BaseAgentOptions["system"];
  request: RequestOptions;
  enableLog?: boolean;
  idb?: IDB;
}

class Rxai extends BaseAgent {
  private cacheMessages: PlanningAgent[] = [];
  private cacheIndex: number = 0;
  private idb?: IDB;

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
    this.idb = options.idb;

    options.idb?.getPlans().then((plans) => {
      plans.forEach(({ plan, content }: any) => {
        // TODO: idb类型定义补充
        const planAgent = new PlanningAgent({
          requestInstance: this.requestInstance,
          tools: [], // TODO：需要传入工具
          system: this.system,
          emits: {
            write: () => {},
            complete: () => {},
            error: () => {},
            cancel: () => {},
          },
          message: plan.content.message,
          // historyMessages: this.cacheMessages.reduce((pre, cur) => {
          //   pre.push(...cur.getMessages());
          //   return pre;
          // }, [] as ChatMessages),
          historyMessages: [],
          attachments: plan.content.attachments,
          presetMessages: plan.content.presetMessages,
          presetHistoryMessages: plan.content.presetHistoryMessages,
          // planList: plan.plan.content.planList,
          // enableLog: true,
          extension: plan.content.extension,
          // idb: this.idb,
        });

        planAgent.recover(content);

        this.cacheMessages.push(planAgent);
      });

      if (this.cacheMessages.length) {
        this.events.emit("plan", this.cacheMessages);
        this.cacheIndex = this.cacheMessages.length;
      }
    });
  }

  register(params: RegisterParams) {
    this.scenes[params.name] = params;
  }

  async requestAI(params: RequestParams) {
    const {
      message,
      emits,
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
      message,
      historyMessages: this.cacheMessages.slice(-20).reduce((pre, cur) => {
        pre.push(...cur.getMessages());
        return pre;
      }, [] as ChatMessages),
      attachments,
      presetMessages: presetMessages || [],
      presetHistoryMessages: presetHistoryMessages || [],
      planList,
      enableLog: typeof enableLog === "boolean" ? enableLog : this.enableLog,
      extension,
      idb: this.idb,
    });

    this.cacheMessages[index] = planningAgent;

    this.events.emit("plan", this.cacheMessages);

    this.idb?.addPlan(planningAgent);

    await planningAgent.run();
  }

  async clear() {
    this.cacheMessages = [];
    this.cacheIndex = 0;
    this.events.emit("plan", this.cacheMessages);

    this.idb?.clear();
  }

  export() {
    return this.cacheMessages.map((planAgent) => {
      return planAgent.export();
    });
  }
}

export { Rxai, RegisterParams, RequestParams };
