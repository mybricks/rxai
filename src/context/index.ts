import { ToolRetryError, RetryError } from "../error/base";

/**
 * 创建工具执行上下文
 */
export function createExecuteContext(options?: {
  currentIndex?: number;
  commands?: ReadonlyArray<{ name: string; params?: Record<string, string> }>;
}): ExecuteContext {
  return {
    ToolRetryError,
    RetryError,
    currentIndex: options?.currentIndex ?? 0,
    commands: options?.commands ?? [],
  };
}
