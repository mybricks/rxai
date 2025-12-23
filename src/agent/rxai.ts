import { BaseAgent, BaseAgentOptions } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, RequestOptions } from "../request/request";
import { Events } from "../utils/events";
import { IDB } from "../utils/idb";
import { getHistoryRecords } from "../tool/getHistoryRecords";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  message: string;
  emits: Emits;
  blockId?: string;
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
  insertAfter?: PlanningAgent;
}

interface RxaiOptions {
  system?: BaseAgentOptions["system"];
  request: RequestOptions;
  enableLog?: boolean;
  idb?: IDB;
}

class Rxai extends BaseAgent {
  private cacheMessages: PlanningAgent[] = [];
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
        const startMessages = [...this.cacheMessages];
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
          historyMessages: (h) => {
            return this.getHistoryMessages({
              historyMessages: startMessages,
              filenames: h,
            });
          },
          attachments: plan.content.attachments,
          presetMessages: plan.content.presetMessages,
          presetHistoryMessages: plan.content.presetHistoryMessages,
          // planList: plan.plan.content.planList,
          // enableLog: true,
          extension: plan.content.extension,
          // idb: this.idb,
          blockId: plan.content.blockId,
          uuid: plan.content.uuid,
        });

        planAgent.recover(content);

        this.cacheMessages.push(planAgent);
      });

      if (this.cacheMessages.length) {
        this.events.emit("plan", this.cacheMessages);
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
      blockId,
      attachments = [],
      presetMessages,
      presetHistoryMessages,
      formatUserMessage,
      tools,
      planList,
      enableLog,
      extension,
      planningCheck,
      insertAfter,
    } = params;

    let startMessages = this.cacheMessages;
    let endMessages: PlanningAgent[] = [];

    if (insertAfter) {
      const insertIndex = this.cacheMessages.findIndex((planAgent) => {
        return planAgent.id === insertAfter.id;
      });

      if (insertIndex !== -1) {
        const targetBlockId = this.cacheMessages[insertIndex].blockId;
        let endIndex = insertIndex + 1;

        while (
          endIndex < this.cacheMessages.length &&
          this.cacheMessages[endIndex].blockId === targetBlockId
        ) {
          endIndex++;
        }

        startMessages = this.cacheMessages.slice(0, insertIndex + 1);
        const abandonedMessages = this.cacheMessages.slice(
          insertIndex + 1,
          endIndex,
        );
        abandonedMessages.forEach((planningAgent) => {
          planningAgent.destroy();
        });
        this.idb?.clear(abandonedMessages);
        endMessages = this.cacheMessages.slice(endIndex);
      }
    }

    const planningAgent = new PlanningAgent({
      requestInstance: this.requestInstance,
      tools: [getHistoryRecords()].concat(
        tools ||
          Object.entries(this.scenes).reduce((pre, [, value]) => {
            pre.push(...value.tools);
            return pre;
          }, [] as Tool[]),
      ),
      system: this.system,
      emits,
      message,
      historyMessages: (h) => {
        return this.getHistoryMessages({
          historyMessages: startMessages,
          filenames: h,
        });
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
      blockId,
    });

    this.cacheMessages = startMessages
      .concat(planningAgent)
      .concat(endMessages);

    this.events.emit("plan", this.cacheMessages);

    this.idb?.addPlan(planningAgent);
    this.idb?.updateOrder(
      this.cacheMessages.map((planningAgent) => planningAgent.id),
    );

    await planningAgent.run();
  }

  async clear() {
    this.cacheMessages = [];
    this.events.emit("plan", this.cacheMessages);

    this.idb?.clear();
    this.idb?.updateOrder([]);
  }

  export() {
    return this.cacheMessages.map((planAgent) => {
      return planAgent.export();
    });
  }

  getHistoryMessages(params: {
    historyMessages: PlanningAgent[];
    filenames: string[];
  }) {
    const { historyMessages, filenames } = params;

    const filenamesMap = filenames.reduce<Record<string, boolean>>(
      (pre, cur) => {
        pre[cur] = true;
        return pre;
      },
      {},
    );
    const recordAttachements: any[] = [];
    let historyMessage =
      "# 历史对话记录" +
      `\n当前对话历史记录，包含所有历史图片，如果需要图片，根据每一轮对话记录的图片位置进行查询`;
    let recordIndex = 1;

    historyMessages.forEach((planAgent, index) => {
      const messages = planAgent.getMessages();
      if (messages) {
        const { message, attachments, summaryMessage } = messages;

        let nextMessage = summaryMessage || message;
        let expend = "完整记录";
        if (summaryMessage) {
          expend = "摘要";
        }
        if (filenamesMap[`history${index + 1}.md`]) {
          nextMessage = message;
          expend = "完整记录";
        }

        historyMessage +=
          `\n\n## 第${recordIndex++}条对话记录` +
          `\n${expend} 文件名：history${index + 1}.md` +
          `\n${nextMessage}`;
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
