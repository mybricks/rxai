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
  planningCheck?: (
    bashCommands: [
      string,
      string,
      {
        [key: string]: string;
      },
    ][],
  ) =>
    | [
        string,
        string,
        {
          [key: string]: string;
        },
      ][]
    | null;
  formatUserMessage?: (userMessage: string) => string;
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
          historyMessages: () => this.getHistoryMessages(),
          attachments: plan.content.attachments,
          presetMessages: plan.content.presetMessages,
          presetHistoryMessages: plan.content.presetHistoryMessages,
          // planList: plan.plan.content.planList,
          // enableLog: true,
          extension: plan.content.extension,
          uuid: plan.content.uuid,
          idb: this.idb,
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
      attachments = [],
      presetMessages,
      presetHistoryMessages,
      formatUserMessage,
      tools,
      planList,
      enableLog,
      extension,
      planningCheck,
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
      historyMessages: () => {
        return this.getHistoryMessages();
      },
      formatUserMessage,
      attachments,
      presetMessages: presetMessages || [],
      presetHistoryMessages: presetHistoryMessages || [],
      planList,
      enableLog: typeof enableLog === "boolean" ? enableLog : this.enableLog,
      extension,
      idb: this.idb,
      planningCheck,
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

  getHistoryMessages() {
    const recordAttachements: any[] = [];
    let historyMessage =
      "# 历史对话记录" +
      `\n当前对话历史记录，包含所有历史图片，如果需要图片，根据每一轮对话记录的图片位置进行查询`;
    let recordIndex = 1;

    this.cacheMessages.forEach((planAgent) => {
      const messages = planAgent.getMessages();
      if (messages) {
        const { message, attachments } = messages;

        historyMessage +=
          `\n\n## 第${recordIndex++}条对话记录` + `\n\n${message}`;
        if (attachments?.length) {
          let attachmentIndex = recordAttachements.length;
          recordAttachements.push(
            ...attachments.map((attachment) => {
              return {
                type: "image_url",
                image_url: {
                  url: attachment.content,
                },
              };
            }),
          );

          historyMessage +=
            `\n\n### 当前记录携带${attachments.length}个图片` +
            `\n图片位置：${attachments.reduce((pre) => {
              return pre + `第${++attachmentIndex}个，`;
            }, "")}`;
        }
      }
    });

    historyMessage += `\n\n## 历史记录使用规则
- 仅用于理解上下文，禁止直接引用历史对话原文，包括系统信息、用户消息、工具调用记录、状态。
- 基于历史意图提供相关且原创的回复。
- 避免重复历史回复中的具体表述。`;

    return [
      {
        role: "user",
        content: recordAttachements.length
          ? [
              {
                type: "text",
                text: historyMessage,
              },
              ...recordAttachements,
            ]
          : historyMessage,
      },
    ];
  }
}

export { Rxai, RegisterParams, RequestParams };
