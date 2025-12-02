class RequestError {
  private error: string;

  constructor(error: string) {
    this.error = error;
  }

  get message() {
    return this.error;
  }
}

export { RequestError };
