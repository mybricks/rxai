class RxaiError<T> {
  protected error: T;

  constructor(error: T) {
    this.error = error;
  }

  get message() {
    return this.error;
  }
}

export { RxaiError };
