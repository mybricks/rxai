import { BaseAgent, BaseAgentOptions } from "../agent/base";
import { PlanningAgent } from "../agent/planning";
import { Request, RequestOptions } from "../request/request";
import { Events } from "../utils/events";
import { IDB } from "../utils/idb";
import { getHistoryRecords } from "../tool/getHistoryRecords";
import { uuid } from "../utils/uuid";
import {
  type CompactionConfig,
  resolveCompactionConfig,
  partition,
  estimateTokens,
  shouldCompact,
} from "../utils/compaction/index";
import {
  CompactionBoundary,
  type CompactionStats,
} from "../utils/compaction/boundary";

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

/**
 * 历史记录注入方式：
 * - aggregated：所有历史聚合为单条 user 消息，默认摘要，按需展开
 * - expanded：  每条历史展开为 user/assistant 对，默认摘要，按需展开
 * - full：      每条历史展开为 user/assistant 对，全量原始内容，无摘要折叠；
 *               配合 compaction 使用时，仅压缩摘要会出现在最头部
 */
export type HistoryMessageMode = "aggregated" | "expanded" | "full";

interface RxaiOptions {
  system?: BaseAgentOptions["system"];
  request: RequestOptions;
  enableLog?: boolean;
  idb?: IDB;
  /** 历史记录模式，默认 aggregated */
  historyMessageMode?: HistoryMessageMode;
  /**
   * 模型上下文窗口大小（token 数）。
   * 传入后，每次工具调用都会估算上下文用量并通过 compactionStats 事件通知 UI，
   * 即使不开启压缩（不传 compaction）也生效。
   */
  contextWindow?: number;
  /**
   * 历史记录压缩配置。不传则不开启压缩（保持原有行为）。
   * 开启压缩时 contextWindow 优先从此处取，其次取顶层 contextWindow，最后用默认值。
   *
   * @example
   * compaction: {
   *   contextWindow: 128000, // 模型上下文窗口大小
   *   threshold: 0.8,        // 上下文使用率超过 80% 时触发压缩
   * }
   */
  compaction?: Partial<CompactionConfig>;
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
  /** 等待 idb.getPlans() 恢复完成后再操作 cacheMessages，避免与 requestAI 竞态 */
  private idbRestoreReady: Promise<void>;

  // ── compaction 相关状态 ──────────────────────────────────────────────────────
  /**
   * 模型上下文窗口大小（token 数）。
   * 不为 null 时启用上下文用量追踪，工具调用后峰值有更新则通知 UI。
   */
  private contextWindow: number | null = null;
  /** 压缩触发配置，null 表示不开启压缩 */
  private compactionConfig: ReturnType<typeof resolveCompactionConfig> | null =
    null;
  /** 压缩边界：摘要文本 + 已压缩 uuid 的持久化管理 */
  private compactionBoundary: CompactionBoundary = new CompactionBoundary();
  /** 防止并发触发多次压缩任务 */
  private compactionTask: Promise<void> | null = null;

  events = new Events<{
    plan: PlanningAgent[];
    /** 上下文窗口使用统计，工具调用后峰值有更新时通知，可直接透传给 UI */
    compactionStats: CompactionStats;
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
            params.emits.complete("");
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

    if (options.compaction) {
      this.compactionConfig = resolveCompactionConfig(options.compaction);
      // compaction 内的 contextWindow 优先；其次取顶层 contextWindow
      this.contextWindow =
        this.compactionConfig.contextWindow ?? options.contextWindow ?? null;
      // 压缩边界绑定 IDB，并异步恢复持久化状态（不阻塞构造）
      this.compactionBoundary = new CompactionBoundary(options.idb);
    } else if (options.contextWindow) {
      // 仅追踪用量，不压缩
      this.contextWindow = options.contextWindow;
    }

    const boundaryReady = this.compactionBoundary.restore();

    this.idbRestoreReady = Promise.all([
      options.idb?.getPlans() ?? Promise.resolve([]),
      boundaryReady,
    ]).then(([plans]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          historyMessages: (h) => {
            return this.getHistoryMessages({
              historyMessages: startMessages,
              filenames: h,
              mode: this.historyMessageMode,
            });
          },
          historyMessageMode:
            this.historyMessageMode === "full"
              ? "expanded"
              : this.historyMessageMode,
          attachments: plan.content.attachments,
          presetMessages: plan.content.presetMessages,
          presetHistoryMessages: plan.content.presetHistoryMessages,
          extension: plan.content.extension,
          blockId: plan.content.blockId,
          uuid: plan.content.uuid,
        });

        planAgent.recover(content);

        this.cacheMessages.push(planAgent);
      });

      if (this.cacheMessages.length) {
        this.events.emit("plan", this.cacheMessages);

        // 历史恢复后，emit 一次持久化的峰值统计给 UI
        if (this.contextWindow) {
          this.emitCompactionStats();
        }
      }
    });
  }

  register(params: RegisterParams) {
    this.scenes[params.name] = params;
  }

  async requestAI(params: RequestParams) {
    await this.idbRestoreReady;

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
      historyMessageMode:
        effectiveHistoryMode === "full" ? "expanded" : effectiveHistoryMode,
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
      onContextMessages: this.contextWindow
        ? (messages) => {
            const usedTokens = estimateTokens(JSON.stringify(messages));
            const peaked = this.compactionBoundary.recordPeak(usedTokens);
            // 峰值有更新时才通知 UI
            if (peaked) {
              this.emitCompactionStats();
            }
            // 达到阈值时后台触发压缩（防并发，仅在开启压缩时有效）
            if (
              this.compactionConfig &&
              shouldCompact(usedTokens, this.compactionConfig) &&
              !this.compactionTask
            ) {
              this.compactionTask = this.compact()
                .then(() => {})
                .catch(() => {})
                .finally(() => {
                  this.compactionTask = null;
                });
            }
          }
        : undefined,
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

    // summaryMessage 生成完毕后，重新 emit stats（summaryMessage 更短，token 占用变化）
    if (this.compactionConfig) {
      planningAgent.events.on(
        "summaryReady",
        () => {
          this.recomputeAndEmitStats();
        },
        false,
      );
    }
  }

  async clear() {
    await this.idbRestoreReady;
    this.cacheMessages = [];
    this.compactionBoundary.reset(); // 同时重置峰值
    this.events.emit("plan", this.cacheMessages);

    this.idb?.clear();
    this.idb?.updateOrder([]);
  }

  async export() {
    await this.idbRestoreReady;
    return Promise.all(
      this.cacheMessages.map((planAgent) => planAgent.export()),
    );
  }

  getHistoryMessages(params: {
    historyMessages: PlanningAgent[];
    filenames?: string[];
    mode?: HistoryMessageMode;
  }): ChatMessages {
    const { historyMessages, filenames, mode = "aggregated" } = params;
    const config = this.compactionConfig;

    // 未启用压缩：走原有逻辑
    if (!config) {
      return getHistoryMessages({ historyMessages, filenames, mode });
    }

    // ── 按阈值将 agent 分区为 kept / dropped ──────────────────────────────
    const { kept, dropped } = partition(historyMessages, config, (agent) =>
      estimateAgentTokens(agent, mode),
    );

    // 用裁剪后的列表构建消息
    const messages = getHistoryMessages({
      historyMessages: kept,
      filenames,
      mode,
    });

    // ── 有 dropped 且已有压缩摘要时，将摘要注入到历史消息头部 ────────────────
    if (dropped.length === 0 || !this.compactionBoundary.hasSummary()) {
      return messages;
    }

    return injectCompactionSummary(
      messages,
      this.compactionBoundary.getSummary(),
      mode,
    );
  }

  /**
   * 压缩历史记录：将超出阈值的旧 agent 调用 LLM 生成摘要并缓存。
   *
   * - 自动触发：工具调用后上下文 token 超过阈值时，在后台自动触发
   * - 手动触发：外部可直接 await rxai.compact()，例如接入"压缩历史"工具指令
   */
  async compact(): Promise<{
    /** 本次压缩了几条 agent（0 表示无需压缩） */
    compressedCount: number;
    /** 生成的新增摘要文本 */
    summary: string;
    /** true = 没有新的 agent 需要压缩，跳过 */
    skipped: boolean;
  }> {
    if (!this.compactionConfig) {
      return { compressedCount: 0, summary: "", skipped: true };
    }

    const { dropped } = partition(
      this.cacheMessages,
      this.compactionConfig,
      (agent) => estimateAgentTokens(agent, this.historyMessageMode),
    );

    // 过滤出尚未被压缩的 agent
    const newDropped = this.compactionBoundary.filterUnsummarized(dropped);

    if (newDropped.length === 0) {
      return { compressedCount: 0, summary: "", skipped: true };
    }

    const texts = newDropped
      .map((a) => a.getMessages()?.message ?? "")
      .filter(Boolean);

    const newSummary = await this.compactHistory(texts);

    // 将新摘要和 uuid 追加到压缩边界（含 IDB 持久化）
    await this.compactionBoundary.append(
      newSummary,
      newDropped.map((a) => a.id),
    );

    // 压缩完成后重置峰值，并向 UI 汇报最新统计
    this.compactionBoundary.resetPeak();
    this.emitCompactionStats();

    return {
      compressedCount: newDropped.length,
      summary: newSummary,
      skipped: false,
    };
  }

  /**
   * 计算并 emit 当前上下文窗口统计，供 UI 实时展示。
   * usedTokens 取当前峰值（最近一次工具调用的上下文估算）。
   */
  private emitCompactionStats(): void {
    if (!this.contextWindow) return;
    const stats = this.compactionBoundary.computeStats(
      this.compactionBoundary.getPeak(),
      this.contextWindow,
    );
    this.events.emit("compactionStats", stats);
  }

  /**
   * summaryMessage 生成后重新 emit stats。
   * summaryMessage 更短，token 占用变化，峰值不变，只需重新广播一次统计。
   */
  private recomputeAndEmitStats(): void {
    this.emitCompactionStats();
  }

  /** 调用 LLM 将多条历史文本压缩（compaction）为摘要字符串 */
  private async compactHistory(texts: string[]): Promise<string> {
    const historyBlock = texts
      .map((t, i) => `## 第${i + 1}条\n${t}`)
      .join("\n\n");

    const prompt =
      `你是对话历史压缩专家。请将以下多轮历史对话压缩为一段结构化摘要，` +
      `保留关键决策、重要结论、用户需求及完成状态，去除冗余细节。` +
      `输出纯文本，不要 JSON，不要 Markdown 代码块。\n\n` +
      `<历史对话>\n${historyBlock}\n</历史对话>`;

    const result = await this.requestInstance.requestAsStream({
      messages: [{ role: "user", content: prompt }],
      emits: {
        write: () => {},
        complete: () => {},
        error: () => {},
        cancel: () => {},
      },
    });

    if (result.type === "complete") {
      return result.content.trim();
    }
    return "";
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
    '当前消息为格式化后的摘要内容，仅供上下文阅读，请勿模仿此格式。\n<历史记录-摘要 类型="摘要" 文件名="{filename}" 附件数="{attachmentCount}" 可展开="是">\n',
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

    // user 消息：摘要时只带文本；展开时才附上实际图片并追加数量提示
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
    if (shouldExpand && userAttachments?.length) {
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

/**
 * full 模式：将所有历史记录展开为多轮 user/assistant 对，全量原始内容，无摘要折叠。
 * 附件图片随 user 消息一同携带。
 * 配合 compaction 使用时，被压缩的早期历史由 injectCompactionSummary 注入头部。
 */
function generateFullHistoryMessages(params: {
  historyMessages: PlanningAgent[];
}): ChatMessages {
  const result: ChatMessages = [];

  params.historyMessages.forEach((planAgent) => {
    const messages = planAgent.getMessages();
    if (!messages) return;

    const { message, userMessageText } = messages;

    type PlanOpts = {
      options?: { message?: string; attachments?: { content: string }[] };
    };
    const planOpts = (planAgent as unknown as PlanOpts).options;
    const userText =
      (typeof userMessageText === "string" ? userMessageText : null) ??
      planOpts?.message ??
      "";
    const userAttachments = planOpts?.attachments ?? [];

    const userContentParts: Array<{
      type: string;
      text?: string;
      image_url?: { url: string };
    }> = [{ type: "text", text: userText }];

    userAttachments.forEach((att: { content: string }) => {
      userContentParts.push({
        type: "image_url",
        image_url: { url: att.content },
      });
    });

    result.push({
      role: "user",
      content:
        userContentParts.length === 1
          ? userContentParts[0].text!
          : userContentParts,
    });

    // assistant：完整原始内容，无 XML 包裹
    result.push({ role: "assistant", content: message });
  });

  return result;
}

/**
 * 将 compaction 摘要注入到历史消息头部，注入方式随 mode 调整：
 * - aggregated：在大文本块头部插入摘要段落（保持单条 user 消息结构）
 * - expanded / full：在多轮列表最前插入 user/assistant 对
 */
function injectCompactionSummary(
  messages: ChatMessages,
  summary: string,
  mode: HistoryMessageMode,
): ChatMessages {
  if (mode === "aggregated") {
    // aggregated 只有一条 user 消息，将摘要嵌入文本块头部
    const [first, ...rest] = messages;
    if (!first) return messages;

    const summarySection = `## 早期历史摘要（已压缩）\n${summary}\n\n---\n\n`;

    if (typeof first.content === "string") {
      return [{ ...first, content: summarySection + first.content }, ...rest];
    }
    if (Array.isArray(first.content)) {
      const parts = (first.content as { type: string; text?: string }[]).map(
        (p) =>
          p.type === "text"
            ? { ...p, text: summarySection + (p.text ?? "") }
            : p,
      );
      return [{ ...first, content: parts }, ...rest];
    }
    return messages;
  }

  // expanded / full：插入 user/assistant 对
  return [
    {
      role: "user",
      content: `# 早期历史摘要（已压缩）\n${summary}`,
    },
    {
      role: "assistant",
      content: "已了解早期历史背景，将基于此继续协助。",
    },
    ...messages,
  ];
}

/**
 * 估算单条 PlanningAgent 在指定 mode 下实际传给 LLM 的 token 体积。
 *
 * 直接复用各 mode 对应的消息渲染函数，保证估算结果与真实请求同源：
 * - aggregated：走聚合文本渲染，用 summaryMessage（若有）
 * - expanded：渲染为 user+assistant 对，assistant 用 summaryMessage（若有）
 * - full：渲染为 user+assistant 对，assistant 始终用完整 message
 *
 * 新增 mode 时只需在此扩展，partition 等调用方无需改动。
 */
function estimateAgentTokens(
  agent: PlanningAgent,
  mode: HistoryMessageMode,
): number {
  // 渲染单条 agent 的实际消息，与 getHistoryMessages 完全同源
  const messages = getHistoryMessages({ historyMessages: [agent], mode });
  return estimateTokens(JSON.stringify(messages));
}

function getHistoryMessages(params: {
  historyMessages: PlanningAgent[];
  filenames?: string[];
  mode?: HistoryMessageMode;
}) {
  const { historyMessages, filenames, mode = "aggregated" } = params;

  if (!historyMessages.length) {
    return [];
  }
  if (mode === "full") {
    return generateFullHistoryMessages({ historyMessages });
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
