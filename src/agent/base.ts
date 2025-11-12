import { Request } from "../request/request";

interface BaseSystem {
  title: string;
}
interface BaseAgentOptions {
  system?: BaseSystem;
  requestInstance: Request;
}

abstract class BaseAgent {
  protected messages: ChatMessages = [];
  protected system: BaseSystem;
  protected requestInstance: Request;

  constructor(options: BaseAgentOptions) {
    this.system = options.system || { title: "MyBricks" };
    this.requestInstance = options.requestInstance;
  }
}

export { BaseAgent, BaseAgentOptions };
