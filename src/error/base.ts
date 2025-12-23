class RxaiError extends Error {
  constructor(
    message: unknown,
    /**
     * 错误类型
     * request - 请求错误
     * retry - 该错误类型支持一键从0开始重试
     * tool - 工具执行错误
     */
    private _type: "request" | "retry" | "tool",
    private _display?: string,
  ) {
    super(
      typeof message === "string"
        ? message
        : message instanceof Error
          ? message.message
          : "未知错误",
    );
    Object.setPrototypeOf(this, RxaiError.prototype);
    this.name = this.constructor.name;
  }

  get type() {
    return this._type;
  }

  get display() {
    return this._display || this.message;
  }

  toJSON() {
    return {
      message: this.message,
      stack: this.stack,
      type: this._type,
      display: this._display,
    };
  }

  recover(params: any) {
    if (params?.stack) {
      this.stack = params.stack;
    }
    return this;
  }
}

export { RxaiError };
