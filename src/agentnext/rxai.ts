import { BaseAgent } from "../agentnext/base";
import { PlanningAgent } from "../agentnext/planning";
import { ApiRequestClient } from "../requestnext";
import { getMode } from "../storage/getMode";

interface RegisterParams {
  name: string;
  tools: Tool[];
}

interface RequestParams {
  message: string | ChatMessages[0];
  emits: Emits;
  key: string;
  attachements: Attachement[];
}

class Rxai extends BaseAgent {
  private cacheMessages: ChatMessages[] = [];
  private cacheIndex: number = 0;
  // 场景
  scenes: Record<string, RegisterParams> = {};

  constructor() {
    super({
      system: { title: "MyBricks" },
    });
  }

  register(params: RegisterParams) {
    this.scenes[params.name] = params;
  }

  async requestAI(params: RequestParams) {
    const { message, emits, key, attachements } = params;
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      request: new ApiRequestClient({ mode: getMode() }),
      tools: Object.entries(this.scenes).reduce((pre, [, value]) => {
        pre.push(...value.tools);
        return pre;
      }, [] as Tool[]),
      system: this.system,
      emits,
      key,
    });

    const nextMessage = attachements?.length
      ? {
          role: "user",
          content: [
            {
              type: "text",
              text: message,
            },
            ...attachements
              .filter((attachement) => {
                return attachement.type === "image";
              })
              .map((attachement) => {
                return {
                  type: "image_url",
                  image_url: {
                    url: attachement.content,
                  },
                };
              }),
          ],
        }
      : message;

    await planningAgent.run(nextMessage);

    this.cacheMessages[index] = planningAgent.getMessages();
  }
}

export { Rxai, RegisterParams, RequestParams };
