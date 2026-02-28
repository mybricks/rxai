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
  /** 是否追加"请根据上述错误信息重试"，默认 true */
  appendRetryMessage?: boolean;
  /** 重试次数，默认 1（仅在 autoRetry 为 true 时生效） */
  maxRetries?: number;
}

class ToolRetryError extends Error {
  readonly llmContent: string;
  readonly displayContent: string;
  readonly autoRetry: boolean;
  readonly maxRetries: number;
  private readonly appendRetryMessage: boolean;

  constructor(params: ToolRetryErrorParams | string) {
    if (typeof params === "string") {
      super(params);
      this.llmContent = params;
      this.displayContent = params;
      this.autoRetry = true;
      this.appendRetryMessage = true;
      this.maxRetries = 1;
    } else {
      const {
        llmContent,
        displayContent,
        autoRetry = true,
        appendRetryMessage = true,
        maxRetries = 1,
      } = params;
      super(llmContent);
      this.llmContent = llmContent;
      this.displayContent = displayContent;
      this.autoRetry = autoRetry;
      this.appendRetryMessage = appendRetryMessage;
      this.maxRetries = Math.max(0, maxRetries);
    }
    this.name = "ToolRetryError";
    Object.setPrototypeOf(this, ToolRetryError.prototype);
  }

  /** 供规划阶段写入当前步骤内容：llmContent + 追加重试提示（若启用） */
  getLlmContentWithRetryMessage(): string {
    return this.appendRetryMessage
      ? this.llmContent + RETRY_APPEND_MESSAGE
      : this.llmContent;
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

/**
 * 全局重试错误：支持用户一键从头（意图识别）开始重试
 */
class RetryError extends Error {
  readonly llmContent: string;
  readonly displayContent: string;

  constructor(message: unknown, display?: string) {
    const msg =
      typeof message === "string"
        ? message
        : message instanceof Error
          ? message.message
          : "需要重新规划";
    super(msg);
    this.name = "RetryError";
    this.llmContent = msg;
    this.displayContent = display || msg;
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
      return new RetryError(message, display);
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
              appendRetryMessage: false,
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

export { RxaiError, RequestError, ToolRetryError, RetryError };

/** execute / stream 的第二个参数，提供错误类等上下文，后续可扩展其他字段 */
export interface ExecuteContext {
  ToolRetryError: typeof ToolRetryError;
  RetryError: typeof RetryError;
}

export function createExecuteContext(): ExecuteContext {
  return {
    ToolRetryError,
    RetryError,
  };
}
