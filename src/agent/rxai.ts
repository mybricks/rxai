import { BaseAgent, BaseAgentOptions } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, RequestOptions } from "../request/request";
import { Events } from "../utils/events";
import { IDB } from "../utils/idb";
import { getHistoryRecords } from "../tool/getHistoryRecords";
import { uuid } from "../utils/uuid";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  system?: BaseAgentOptions["system"];
  message: string;
  emits: Emits;
  blockId?: string;
  attachments?: Attachment[];
  presetMessages?:
    | ChatMessages
    | (() => ChatMessages)
    | (() => Promise<ChatMessages>);
  presetHistoryMessages?: ChatMessages;
  guidePrompt?: string;
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
  key = uuid();
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
      system,
      message,
      emits,
      blockId,
      attachments = [],
      presetMessages,
      presetHistoryMessages,
      guidePrompt,
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
      system: system ?? this.system,
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
      guidePrompt,
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

  async export() {
    return Promise.all(
      this.cacheMessages.map((planAgent) => planAgent.export()),
    );
  }

  getHistoryMessages(params: {
    historyMessages: PlanningAgent[];
    filenames?: string[];
  }) {
    return getHistoryMessages(params);
  }
}

export { Rxai, RegisterParams, RequestParams };

const HISTORY_MESSAGES_CONSTANTS = {
  HISTORY_TITLE: "# 历史对话记录",
  SUMMARY_TIP:
    '\n当前对话历史记录摘要信息，对话内容以及附件图片都已做折叠处理，如果需要详细的内容，请使用"get-history-records"工具读取',
  FULL_CONTENT_TIP:
    "\n当前对话历史记录，包含摘要记录，以及需要提高关注的完整记录内容，完整记录包含图片，可以根据完整记录图片位置进行查询",
  USAGE_RULES: `\n\n## 历史记录使用规则
- 仅用于理解上下文，禁止直接引用历史对话原文，包括系统信息、用户消息、工具调用记录、状态。
- 基于历史意图提供相关且原创的回复。
- 避免重复历史回复中的具体表述。`,
  FILE_NAME_PREFIX: "history",
  FILE_EXTENSION: ".md",
  SUMMARY_LABEL: "摘要",
  FULL_CONTENT_LABEL: "完整记录",
  IMAGE_SECTION_TITLE: "\n### 当前记录携带{count}个图片",
  IMAGE_POSITION_TIP: "\n图片位置：{positions}",
};

function getHistoryMessages(params: {
  historyMessages: PlanningAgent[];
  filenames?: string[];
}) {
  const { historyMessages, filenames } = params;
  const isFilenamesProvided = Array.isArray(filenames);
  const filenamesSet = isFilenamesProvided
    ? new Set(filenames)
    : new Set<string>();

  // 没有历史记录，空文件名数组
  if (
    !historyMessages.length ||
    (isFilenamesProvided && filenames.length === 0)
  ) {
    return [];
  }

  // 生成单条对话记录的文本片段
  const generateSingleRecordText = (
    planAgent: PlanningAgent,
    index: number,
    recordIndex: number,
    isFullContentMode: boolean,
  ): {
    text: string;
    attachments: Array<{ type: string; image_url: { url: string } }>;
  } => {
    const messages = planAgent.getMessages();
    if (!messages) return { text: "", attachments: [] };

    const { message, attachments, summaryMessage } = messages;
    const filename = `${HISTORY_MESSAGES_CONSTANTS.FILE_NAME_PREFIX}${index + 1}${HISTORY_MESSAGES_CONSTANTS.FILE_EXTENSION}`;

    const isNeedFullContent = isFullContentMode && filenamesSet.has(filename);
    const displayMessage = isNeedFullContent
      ? message
      : summaryMessage || message;
    const expandLabel =
      isNeedFullContent || !summaryMessage
        ? HISTORY_MESSAGES_CONSTANTS.FULL_CONTENT_LABEL
        : HISTORY_MESSAGES_CONSTANTS.SUMMARY_LABEL;

    let recordText =
      `\n\n## 第${recordIndex}条对话记录` +
      `\n${expandLabel} 文件名：${filename}` +
      `\n${displayMessage}`;

    const imageAttachments: Array<{
      type: string;
      image_url: { url: string };
    }> = [];
    if (attachments?.length) {
      recordText += HISTORY_MESSAGES_CONSTANTS.IMAGE_SECTION_TITLE.replace(
        "{count}",
        attachments.length.toString(),
      );

      if (isNeedFullContent) {
        imageAttachments.push(
          ...attachments.map((attachment) => ({
            type: "image_url",
            image_url: { url: attachment.content },
          })),
        );

        recordText += HISTORY_MESSAGES_CONSTANTS.IMAGE_POSITION_TIP.replace(
          "{positions}",
          imageAttachments.map((_, idx) => `第${idx + 1}个`).join("，"),
        );
      }
    }

    return { text: recordText, attachments: imageAttachments };
  };

  const isFullContentMode = isFilenamesProvided;
  let mainText =
    HISTORY_MESSAGES_CONSTANTS.HISTORY_TITLE +
    (isFullContentMode
      ? HISTORY_MESSAGES_CONSTANTS.FULL_CONTENT_TIP
      : HISTORY_MESSAGES_CONSTANTS.SUMMARY_TIP);
  const allAttachments: Array<{ type: string; image_url: { url: string } }> =
    [];

  historyMessages.forEach((planAgent, index) => {
    const recordIndex = index + 1; // 对话记录的序号（从1开始）
    const { text, attachments } = generateSingleRecordText(
      planAgent,
      index,
      recordIndex,
      isFullContentMode,
    );
    mainText += text;
    allAttachments.push(...attachments);
  });

  mainText += HISTORY_MESSAGES_CONSTANTS.USAGE_RULES;

  const content =
    allAttachments.length > 0
      ? [{ type: "text", text: mainText }, ...allAttachments]
      : mainText;

  return [{ role: "user", content }];
}
