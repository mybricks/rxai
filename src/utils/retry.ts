const retry = <T>(
  execute: (attempt: number) => T,
  count: number,
  check?: (error: unknown) => boolean,
): Promise<T> => {
  return new Promise((resolve, reject) => {
    const totalAttempts = count + 1;
    const attempt = (remaining: number) => {
      const currentAttempt = totalAttempts - remaining;
      try {
        const result = execute(currentAttempt);

        if (result instanceof Promise) {
          result.then(resolve).catch((error) => {
            if (remaining > 1 && (check ? check(error) : true)) {
              console.error(`重试中... 剩余次数: ${remaining - 2}`, error);
              attempt(remaining - 1);
            } else {
              reject(error);
            }
          });
        } else {
          resolve(result);
        }
      } catch (error) {
        if (remaining > 1 && (check ? check(error) : true)) {
          console.error(`重试中... 剩余次数: ${remaining - 2}`, error);
          attempt(remaining - 1);
        } else {
          reject(error);
        }
      }
    };

    attempt(totalAttempts);
  });
};

export { retry };
