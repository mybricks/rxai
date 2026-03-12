import { IDB } from "../idb";
import { estimateTokens } from "./index";

// ─── 上下文窗口统计（透传给 UI） ──────────────────────────────────────────────

/**
 * 上下文窗口使用统计，可直接透传给 UI 展示。
 */
export interface CompactionStats {
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 本轮估算的上下文 token 用量 */
  usedTokens: number;
  /** 历史中压缩摘要占用的 token */
  summaryTokens: number;
  /** 上下文使用率（0 ~ 1） */
  usageRatio: number;
  /** 是否已有压缩摘要（即是否触发过压缩） */
  hasCompaction: boolean;
  /** 自上次压缩/清除以来，记录到的上下文峰值 token */
  peakTokens: number;
}

// ─── 压缩边界管理 ─────────────────────────────────────────────────────────────

/**
 * 压缩边界管理。
 *
 * 职责：
 * - 记录哪些 agent（uuid）已经被压缩进摘要
 * - 持有当前累计的压缩摘要文本
 * - 负责向 IDB 读写持久化记录（含 peakTokens）
 * - 追踪自上次压缩/清除以来的上下文峰值 token
 * - 基于边界计算上下文窗口统计，透传给 UI
 */
export class CompactionBoundary {
  /** 已压缩的历史摘要文本（早期被裁掉 agent 的摘要） */
  private summary: string = "";

  /** 已完成压缩的 agent uuid 集合，避免重复压缩 */
  private summarizedUuids: Set<string> = new Set();

  /** 自上次压缩/清除以来，记录到的上下文峰值 token（持久化） */
  private peakTokens: number = 0;

  /** 当前绑定的 IDB 实例，用于持久化 */
  private idb: IDB | undefined;

  constructor(idb?: IDB) {
    this.idb = idb;
  }

  // ─── 初始化 ────────────────────────────────────────────────────────────────

  /** 从 IDB 恢复压缩边界状态（在 Rxai 构造时异步调用） */
  async restore(): Promise<void> {
    if (!this.idb) return;
    const record = await this.idb.getCompaction();
    if (record) {
      this.summary = record.summary;
      this.summarizedUuids = new Set(record.summarizedUuids);
      this.peakTokens = record.peakTokens ?? 0;
    }
  }

  // ─── 查询 ──────────────────────────────────────────────────────────────────

  getSummary(): string {
    return this.summary;
  }

  hasSummary(): boolean {
    return this.summary.length > 0;
  }

  /** 从候选列表中过滤出尚未被压缩的 agent */
  filterUnsummarized<T extends { id: string }>(agents: T[]): T[] {
    return agents.filter((a) => !this.summarizedUuids.has(a.id));
  }

  // ─── 峰值追踪 ─────────────────────────────────────────────────────────────

  /**
   * 记录本轮的上下文 token 估算值，若高于历史峰值则更新并持久化。
   * 应在每次工具调用完成后调用。
   * @returns true 表示峰值有更新，false 表示未超过历史峰值
   */
  recordPeak(usedTokens: number): boolean {
    if (usedTokens > this.peakTokens) {
      this.peakTokens = usedTokens;
      this.persistPeak();
      return true;
    }
    return false;
  }

  getPeak(): number {
    return this.peakTokens;
  }

  /** 重置峰值并持久化（压缩完成或清除对话时调用） */
  resetPeak(): void {
    this.peakTokens = 0;
    this.persistPeak();
  }

  // ─── 统计 ─────────────────────────────────────────────────────────────────

  /**
   * 计算当前上下文窗口使用统计，供 UI 展示。
   *
   * @param usedTokens    本轮估算的上下文 token 用量
   * @param contextWindow 模型上下文窗口大小
   */
  computeStats(usedTokens: number, contextWindow: number): CompactionStats {
    const summaryTokens = estimateTokens(this.summary);
    const usageRatio = contextWindow > 0 ? usedTokens / contextWindow : 0;

    return {
      contextWindow,
      usedTokens,
      summaryTokens,
      usageRatio,
      hasCompaction: this.hasSummary(),
      peakTokens: this.peakTokens,
    };
  }

  // ─── 更新 ──────────────────────────────────────────────────────────────────

  /**
   * 追加一批新压缩的结果到边界：
   * - 将新摘要合并到已有摘要
   * - 将新 uuid 加入已压缩集合
   * - 持久化到 IDB（含 peakTokens）
   */
  async append(newSummary: string, newUuids: string[]): Promise<void> {
    if (!newSummary) return;

    this.summary = this.summary
      ? `${this.summary}\n\n---\n\n${newSummary}`
      : newSummary;

    newUuids.forEach((id) => this.summarizedUuids.add(id));

    await this.persist();
  }

  // ─── 重置 ──────────────────────────────────────────────────────────────────

  /** 清空所有内存状态（clear 对话时调用，IDB 侧由 idb.clear() 负责） */
  reset(): void {
    this.summary = "";
    this.summarizedUuids = new Set();
    this.peakTokens = 0;
  }

  // ─── 内部持久化 ───────────────────────────────────────────────────────────

  /** 将完整状态写入 IDB */
  private async persist(): Promise<void> {
    await this.idb?.putCompaction({
      summary: this.summary,
      summarizedUuids: Array.from(this.summarizedUuids),
      peakTokens: this.peakTokens,
    });
  }

  /** 仅更新 peakTokens，fire-and-forget（不等待结果） */
  private persistPeak(): void {
    this.persist().catch(() => {});
  }
}
