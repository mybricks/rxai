const retry = <T>(execute: () => T, count: number): Promise<T> => {
  return new Promise((resolve, reject) => {
    const attempt = (currentCount: number) => {
      try {
        const result = execute();

        if (result instanceof Promise) {
          result.then(resolve).catch((error) => {
            if (currentCount > 1) {
              console.log(`重试中... 剩余次数: ${currentCount - 2}`);
              attempt(currentCount - 1);
            } else {
              reject(error);
            }
          });
        } else {
          resolve(result);
        }
      } catch (error) {
        if (currentCount > 1) {
          console.log(`重试中... 剩余次数: ${currentCount - 2}`);
          attempt(currentCount - 1);
        } else {
          reject(error);
        }
      }
    };

    attempt(count + 1);
  });
};

export { retry };
