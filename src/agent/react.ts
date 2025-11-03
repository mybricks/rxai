import { BaseAgent } from "./base";

export abstract class ReActAgent extends BaseAgent {
  protected abstract think(): Promise<boolean>;
  protected abstract act(): Promise<string>;

  async step(): Promise<string> {
    const shouldAct = await this.think();
    if (!shouldAct) {
      return "Thinking complete - no action needed";
    }
    const result = await this.act();
    return result;
  }
}
