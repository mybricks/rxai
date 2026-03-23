// ============ 独立错误类 ============

const RETRY_APPEND_MESSAGE = "\n\n请根据上述错误信息重试。";

/**
 * 请求错误：可重试的网络/请求级错误
 * maxRetries 不传时使用 requestInstance.maxRetries
 */
class RequestError extends Error {
  readonly llmContent: string;
  readonly displayContent: string;
  readonly maxRetries?: number;

  constructor(message: unknown, maxRetries?: number) {
    const msg =
      typeof message === "string"
        ? message
        : message instanceof Error
          ? message.message
          : "请求错误";
    super(msg);
    this.name = "RequestError";
    this.llmContent = msg;
    this.displayContent = msg;
    this.maxRetries = maxRetries;
    Object.setPrototypeOf(this, RequestError.prototype);
  }

  toJSON() {
    return {
      message: this.message,
      stack: this.stack,
      type: "request",
      llmContent: this.llmContent,
      displayContent: this.displayContent,
    };
  }
}

/**
 * 工具执行错误：可自定义给 LLM 和用户的展示内容，支持追加重试提示并指定重试次数
 */
export interface ToolRetryErrorParams {
  llmContent: string;
  displayContent: string;
  /** 是否自动重试，默认 true。false 时只展示错误并提供重试按钮 */
  autoRetry?: boolean;
  /** 重试次数，默认 1（仅在 autoRetry 为 true 时生效） */
  maxRetries?: number;
}

class ToolRetryError extends Error {
  readonly llmContent: string;
  readonly displayContent: string;
  readonly autoRetry: boolean;
  readonly maxRetries: number;

  constructor(params: ToolRetryErrorParams | string) {
    if (typeof params === "string") {
      super(params);
      this.llmContent = params;
      this.displayContent = params;
      this.autoRetry = true;
      this.maxRetries = 1;
    } else {
      const {
        llmContent,
        displayContent,
        autoRetry = true,
        maxRetries = 1,
      } = params;
      super(llmContent);
      this.llmContent = llmContent;
      this.displayContent = displayContent;
      this.autoRetry = autoRetry;
      this.maxRetries = Math.max(0, maxRetries);
    }
    this.name = "ToolRetryError";
    Object.setPrototypeOf(this, ToolRetryError.prototype);
  }

  /** 供规划阶段写入当前步骤内容：llmContent + 追加重试提示 */
  getLlmContentWithRetryMessage(): string {
    return this.llmContent + RETRY_APPEND_MESSAGE;
  }

  toJSON() {
    return {
      message: this.message,
      stack: this.stack,
      type: "tool",
      llmContent: this.llmContent,
      displayContent: this.displayContent,
      autoRetry: this.autoRetry,
    };
  }
}

export interface RetryErrorOptions {
  display?: string;
  /** 自动重试次数，默认 2（表示总共执行 2 次：1 次初始 + 1 次重试） */
  maxRetries?: number;
}

/**
 * 全局重试错误：框架自动从头（意图识别）重新规划。
 * maxRetries 控制自动重试次数，用尽后转为用户手动重试。
 */
class RetryError extends Error {
  readonly llmContent: string;
  readonly displayContent: string;
  readonly maxRetries: number;

  constructor(message: unknown, options?: RetryErrorOptions) {
    const msg =
      typeof message === "string"
        ? message
        : message instanceof Error
          ? message.message
          : "需要重新规划";
    super(msg);
    this.name = "RetryError";
    this.llmContent = msg;
    this.displayContent = options?.display || msg;
    this.maxRetries = Math.max(0, options?.maxRetries ?? 2);
    Object.setPrototypeOf(this, RetryError.prototype);
  }

  toJSON() {
    return {
      message: this.message,
      stack: this.stack,
      type: "retry",
      llmContent: this.llmContent,
      displayContent: this.displayContent,
    };
  }
}

// ============ RxaiError 兼容层（仅用于向后兼容旧代码） ============

/**
 * @deprecated 仅用于向后兼容，新代码请直接使用 RequestError、ToolRetryError、RetryError
 */
function RxaiError(
  message: unknown,
  type: "request" | "retry" | "tool",
  display?: string,
): RequestError | RetryError | ToolRetryError {
  switch (type) {
    case "request":
      return new RequestError(message);
    case "retry":
      return new RetryError(message, { display });
    case "tool":
      return new ToolRetryError(
        typeof display === "string"
          ? {
              llmContent:
                typeof message === "string"
                  ? message
                  : message instanceof Error
                    ? message.message
                    : "工具执行错误",
              displayContent: display,
              autoRetry: false,
              maxRetries: 0,
            }
          : typeof message === "string"
            ? message
            : message instanceof Error
              ? message.message
              : "工具执行错误",
      );
  }
}

// 类型守卫工具（兼容方式，避免 namespace）
RxaiError.isRequest = (e: unknown): e is RequestError =>
  e instanceof RequestError;
RxaiError.isTool = (e: unknown): e is ToolRetryError =>
  e instanceof ToolRetryError;
RxaiError.isRetry = (e: unknown): e is RetryError => e instanceof RetryError;

/**
 * 取消错误：用户主动终止请求，不视为错误，不触发重试
 */
class CancelError extends Error {
  readonly type = "cancel" as const;

  constructor(message = "已取消") {
    super(message);
    this.name = "CancelError";
    Object.setPrototypeOf(this, CancelError.prototype);
  }
}

export { RxaiError, RequestError, ToolRetryError, RetryError, CancelError };
