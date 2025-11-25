import { Request } from "../request/request";

interface BaseSystem {
  title: string;
}
interface BaseAgentOptions {
  system?: BaseSystem;
  requestInstance: Request;
  enableLog?: boolean;
}

abstract class BaseAgent {
  protected messages: ChatMessages = [];
  protected system: BaseSystem;
  protected requestInstance: Request;
  protected enableLog: boolean;

  constructor(options: BaseAgentOptions) {
    this.system = options.system || { title: "MyBricks" };
    this.requestInstance = options.requestInstance;
    this.enableLog = !!options.enableLog;
  }
}

export { BaseAgent, BaseAgentOptions };
