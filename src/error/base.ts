interface RxaiErrorOptions<E> {
  error: E;
  type: string;
}

class RxaiError<E> {
  protected error: E;

  type: string;

  constructor(options: RxaiErrorOptions<E>) {
    this.error = options.error;
    this.type = options.type;
  }

  get message() {
    return this.error;
  }
}

export { RxaiError };
