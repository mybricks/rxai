import { Request } from "../request/request";

interface BaseSystem {
  title: string;
  prompt?: string;
}
interface BaseAgentOptions {
  system?: BaseSystem;
  requestInstance: Request;
  enableLog?: boolean;
}

abstract class BaseAgent {
  protected messages: ChatMessages = [];
  protected system: Required<BaseSystem>;
  protected requestInstance: Request;
  protected enableLog: boolean;

  constructor(options: BaseAgentOptions) {
    this.system = {
      title: "MyBricks.ai",
      prompt: "",
      ...options.system,
    };
    this.requestInstance = options.requestInstance;
    this.enableLog = !!options.enableLog;
  }
}

export { BaseAgent, BaseAgentOptions };
