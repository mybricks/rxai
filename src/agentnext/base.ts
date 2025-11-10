interface BaseSystem {
  title: string;
}
interface BaseAgentOptions {
  system: BaseSystem;
}

abstract class BaseAgent {
  protected messages: ChatMessages = [];
  protected system: BaseSystem;

  constructor(options: BaseAgentOptions) {
    this.system = options.system;
  }
}

export { BaseAgent, BaseAgentOptions };
