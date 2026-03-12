// ─── Token 估算 ───────────────────────────────────────────────────────────────

/** 粗估：4 字符 ≈ 1 token（对中英文混合内容留有余量） */
const CHARS_PER_TOKEN = 4;

/** 安全裕量：补偿 chars/4 对 CJK、代码 token 的低估 */
const SAFETY_MARGIN = 1.2;

export const DEFAULT_CONTEXT_WINDOW = 128_000;

// ─── 配置 ─────────────────────────────────────────────────────────────────────

export interface CompactionConfig {
  /** 模型上下文窗口大小，默认 128_000 */
  contextWindow?: number;
  /**
   * 触发压缩的上下文使用率阈值（0 ~ 1），默认 0.8。
   * 当某轮工具调用后估算的上下文 token 占比超过此值时，触发一次 compact。
   */
  threshold?: number;
}

export const DEFAULT_COMPACTION_CONFIG: Required<CompactionConfig> = {
  contextWindow: DEFAULT_CONTEXT_WINDOW,
  threshold: 0.8,
};

export function resolveCompactionConfig(
  partial?: Partial<CompactionConfig>,
): Required<CompactionConfig> {
  return { ...DEFAULT_COMPACTION_CONFIG, ...partial };
}

// ─── Token 估算 ───────────────────────────────────────────────────────────────

export function estimateTokens(content: unknown): number {
  const str =
    typeof content === "string" ? content : JSON.stringify(content ?? "");
  return Math.ceil((str.length / CHARS_PER_TOKEN) * SAFETY_MARGIN);
}

// ─── 触发判断 ─────────────────────────────────────────────────────────────────

/**
 * 判断当前上下文 token 用量是否超过压缩阈值。
 *
 * @param usedTokens  本轮估算的上下文总 token（包含 historyMessages 等所有部分）
 * @param config      压缩配置
 */
export function shouldCompact(
  usedTokens: number,
  config: Required<CompactionConfig>,
): boolean {
  return usedTokens / config.contextWindow >= config.threshold;
}

// ─── 历史分区（PlanningAgent 粒度） ───────────────────────────────────────────

export interface PartitionResult<T> {
  /** 保留的近期 agent（直接发给 LLM） */
  kept: T[];
  /** 待压缩的旧 agent */
  dropped: T[];
  /** kept 部分的 token 合计 */
  keptTokens: number;
  /** dropped 部分的 token 合计 */
  droppedTokens: number;
  /** 全部 agent 的 token 合计 */
  totalTokens: number;
}

/**
 * 将 agent 列表分区为 kept（近期保留）和 dropped（超出阈值待压缩）。
 *
 * 策略：从末尾向前贪心累计，保留不超过 `contextWindow * threshold / 2` 的近期历史，
 * 其余旧 agent 放入 dropped 等待压缩。
 * 这样压缩后近期历史仍有充足空间，不会立即再次触发。
 *
 * @param getAgentTokens 返回单条 agent 的估算 token 数
 */
export function partition<T>(
  agents: T[],
  config: Required<CompactionConfig>,
  getAgentTokens: (agent: T) => number,
): PartitionResult<T> {
  // 保留额度 = 上下文窗口 × 阈值的一半，给近期历史留出宽松空间
  const keepBudget = Math.floor((config.contextWindow * config.threshold) / 2);

  const agentTokens = agents.map((a) => getAgentTokens(a));
  const totalTokens = agentTokens.reduce((s, t) => s + t, 0);

  const kept: T[] = [];
  const dropped: T[] = [];
  let keptTokens = 0;

  for (let i = agents.length - 1; i >= 0; i--) {
    const t = agentTokens[i];
    if (keptTokens + t <= keepBudget) {
      kept.unshift(agents[i]);
      keptTokens += t;
    } else {
      dropped.unshift(agents[i]);
    }
  }

  return {
    kept,
    dropped,
    keptTokens,
    droppedTokens: totalTokens - keptTokens,
    totalTokens,
  };
}
