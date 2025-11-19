function throttle<T extends (...args: any[]) => any>(
  func: T,
  wait: number,
): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Parameters<T> | null = null;

  const throttled = function (this: any, ...args: Parameters<T>) {
    // 保存最新的参数
    pendingArgs = args;

    // 如果已经有定时器在运行，直接返回
    if (timeout) {
      return;
    }

    // 设置节流定时器
    timeout = setTimeout(() => {
      if (pendingArgs) {
        func.apply(this, pendingArgs);
        pendingArgs = null;
      }
      timeout = null;
    }, wait);
  } as T & { cancel: () => void };

  // 添加取消方法
  throttled.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    pendingArgs = null;
  };

  return throttled;
}

export { throttle };
