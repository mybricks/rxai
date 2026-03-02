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
  /** 追加命令的最大深度，防止循环追加；不传则使用默认值 5 */
  maxAppendDepth?: number;
  /** 本次请求使用的历史记录模式，覆盖 Rxai 实例默认 */
  historyMessageMode?: HistoryMessageMode;
}

/** 历史记录注入方式：聚合（单条 user 消息）或展开（多轮 user/assistant） */
export type HistoryMessageMode = "aggregated" | "expanded";

interface RxaiOptions {
  system?: BaseAgentOptions["system"];
  request: RequestOptions;
  enableLog?: boolean;
  idb?: IDB;
  /** 历史记录模式：aggregated=单条聚合，expanded=按轮次展开为 user/assistant 对，默认 aggregated */
  historyMessageMode?: HistoryMessageMode;
  /** 预置的 LLM 返回文本，按调用顺序消耗；用完后后续请求（含 appendCommand、报错、后续轮）走真实 request */
  mock?: {
    responses: string[];
    /** 每次返回预置内容前的延迟（毫秒），用于模拟网络/流式延迟 */
    delay?: number;
  };
}

class Rxai extends BaseAgent {
  key = uuid();
  private cacheMessages: PlanningAgent[] = [];
  private idb?: IDB;
  private historyMessageMode: HistoryMessageMode;

  events = new Events<{
    plan: PlanningAgent[];
  }>();

  // 场景
  scenes: Record<string, RegisterParams> = {};

  constructor(options: RxaiOptions) {
    const requestOptions: RequestOptions = (() => {
      const real = options.request.requestAsStream;
      const queue = options.mock?.responses ? [...options.mock.responses] : [];
      const delayMs = options.mock?.delay ?? 0;
      return {
        ...options.request,
        requestAsStream: async (
          params: Parameters<RequestOptions["requestAsStream"]>[0],
        ) => {
          if (queue.length > 0) {
            const text = queue.shift()!;
            if (delayMs > 0) {
              await new Promise((r) => setTimeout(r, delayMs));
            }
            params.emits.write(text);
            params.emits.complete();
            return;
          }
          return real(params);
        },
      };
    })();

    super({
      ...options,
      requestInstance: new Request(requestOptions),
    });
    this.idb = options.idb;
    this.historyMessageMode = options.historyMessageMode ?? "aggregated";

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
              mode: this.historyMessageMode,
            });
          },
          historyMessageMode: this.historyMessageMode,
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
      maxAppendDepth,
      historyMessageMode,
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

    const effectiveHistoryMode =
      historyMessageMode ?? this.historyMessageMode ?? "aggregated";

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
          mode: effectiveHistoryMode,
        });
      },
      historyMessageMode: effectiveHistoryMode,
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
      maxAppendDepth,
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
    mode?: HistoryMessageMode;
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
  /** 摘要时仅用结构化信息告知附件，不携带图片（聚合模式使用） */
  ATTACHMENT_INFO_SUMMARY: "\n本记录包含 {count} 个附件",
  /** 完整记录时的图片说明（聚合模式展开后使用） */
  IMAGE_SECTION_TITLE: "\n### 当前记录携带{count}个图片",
  IMAGE_POSITION_TIP: "\n图片位置：{positions}",
  /**
   * 展开模式：assistant 消息的结构化包裹。
   * - 包含附件数量用纯数字（0 表示无），语义中立。
   * - 摘要块加「请勿模仿此格式输出」约束，避免模型把它当回复格式学习。
   * - 图片位置说明已移至 user 消息尾部，assistant 不重复。
   */
  ASSISTANT_SUMMARY_META:
    '<历史记录-摘要 类型="摘要" 文件名="{filename}" 附件数="{attachmentCount}" 可展开="是">\n（以下为系统存档的摘要，仅供上下文参考，请勿模仿此格式输出）\n\n',
  ASSISTANT_SUMMARY_META_END: "\n</历史记录-摘要>",
  ASSISTANT_FULL_META:
    '<历史记录-完整 类型="完整记录" 文件名="{filename}" 附件数="{attachmentCount}">\n\n',
  ASSISTANT_FULL_META_END: "\n</历史记录-完整>",
  /** 展开模式：user 消息尾部追加的附件提示（完整记录时） */
  USER_ATTACHMENT_HINT: "\n[本条消息包含 {count} 张附件图片]",
};

/**
 * 展开模式：将历史记录生成为多轮 user/assistant 消息对，便于后续 agent 延续对话。
 * 每轮：一条 user（用户当轮提问 + 附件），一条 assistant（该轮规划与执行结果，默认摘要，被读取则用完整内容）。
 */
function generateExpandedHistoryMessages(params: {
  historyMessages: PlanningAgent[];
  filenames?: string[];
}): ChatMessages {
  const { historyMessages, filenames } = params;
  const isFilenamesProvided = Array.isArray(filenames);
  const filenamesSet = isFilenamesProvided
    ? new Set(filenames)
    : new Set<string>();

  const result: ChatMessages = [];

  historyMessages.forEach((planAgent, index) => {
    const messages = planAgent.getMessages();
    if (!messages) return;

    const { message, summaryMessage, attachments, userMessageText } = messages;
    const filename = `${HISTORY_MESSAGES_CONSTANTS.FILE_NAME_PREFIX}${index + 1}${HISTORY_MESSAGES_CONSTANTS.FILE_EXTENSION}`;
    const shouldExpand = isFilenamesProvided && filenamesSet.has(filename);
    const assistantContent = shouldExpand ? message : summaryMessage || message;

    // 用户消息：优先使用格式化后的 userMessageText，否则回退到 options.message
    type PlanOpts = {
      options?: { message?: string; attachments?: { content: string }[] };
    };
    const planOpts = (planAgent as unknown as PlanOpts).options;
    const userText =
      (typeof userMessageText === "string" ? userMessageText : null) ??
      planOpts?.message ??
      "";
    const userAttachments = planOpts?.attachments;
    const attachmentCount = attachments?.length ?? 0;

    // user 消息：文本 + 实际附件图片（完整记录时在文字尾部追加图片数量提示）
    const userTextWithHint =
      shouldExpand && attachmentCount > 0
        ? userText +
          HISTORY_MESSAGES_CONSTANTS.USER_ATTACHMENT_HINT.replace(
            "{count}",
            String(attachmentCount),
          )
        : userText;
    const userContentParts: Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }> = [{ type: "text", text: userTextWithHint }];
    if (userAttachments?.length) {
      userAttachments.forEach((att: { content: string }) => {
        userContentParts.push({
          type: "image_url",
          image_url: { url: att.content },
        });
      });
    }
    result.push({
      role: "user",
      content:
        userContentParts.length === 1
          ? userContentParts[0].text!
          : userContentParts,
    });

    // assistant 消息：结构化包裹（摘要/完整），附件数用纯数字，图片位置说明不在此重复
    let assistantPayload: string = assistantContent;

    if (shouldExpand) {
      const meta = HISTORY_MESSAGES_CONSTANTS.ASSISTANT_FULL_META.replace(
        "{filename}",
        filename,
      ).replace("{attachmentCount}", String(attachmentCount));
      assistantPayload =
        meta +
        assistantPayload +
        HISTORY_MESSAGES_CONSTANTS.ASSISTANT_FULL_META_END;
    } else {
      const meta = HISTORY_MESSAGES_CONSTANTS.ASSISTANT_SUMMARY_META.replace(
        "{filename}",
        filename,
      ).replace("{attachmentCount}", String(attachmentCount));
      assistantPayload =
        meta +
        assistantPayload +
        HISTORY_MESSAGES_CONSTANTS.ASSISTANT_SUMMARY_META_END;
    }

    result.push({
      role: "assistant",
      content: assistantPayload,
    });
  });

  return result;
}

function getHistoryMessages(params: {
  historyMessages: PlanningAgent[];
  filenames?: string[];
  mode?: "aggregated" | "expanded";
}) {
  const { historyMessages, filenames, mode = "aggregated" } = params;

  if (!historyMessages.length) {
    return [];
  }
  if (mode === "expanded") {
    return generateExpandedHistoryMessages({ historyMessages, filenames });
  }

  const isFilenamesProvided = Array.isArray(filenames);
  const filenamesSet = isFilenamesProvided
    ? new Set(filenames)
    : new Set<string>();

  if (isFilenamesProvided && filenames!.length === 0) {
    return [];
  }

  // 生成单条对话记录的文本片段（聚合模式）
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
      if (isNeedFullContent) {
        recordText += HISTORY_MESSAGES_CONSTANTS.IMAGE_SECTION_TITLE.replace(
          "{count}",
          attachments.length.toString(),
        );
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
      } else {
        // 摘要：仅结构化告知包含附件，不携带图片
        recordText +=
          HISTORY_MESSAGES_CONSTANTS.ATTACHMENT_INFO_SUMMARY.replace(
            "{count}",
            attachments.length.toString(),
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
