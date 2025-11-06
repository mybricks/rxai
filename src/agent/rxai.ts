/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Tool, RxToolContext } from "../tool/base";
import { Emits, Request, ApiRequestClient } from "../request";
import { getSystemPrompt } from "../prompt/planning";
import { PlanningAgent, BaseAgent, BaseAgentOptions } from "../agent/planning";

interface RxaiOptions {
  request: Request;
  tools?: (typeof Tool)[];
  system?: System;
}

interface System {
  title: string;
}

class Rxai extends BaseAgent {
  private request: Request;
  private cacheMessages: ChatMessages[] = [];
  private cacheIndex: number = 0;
  private tools: (typeof Tool)[];
  constructor(options: RxaiOptions) {
    super({
      system: options.system || { title: "MyBricks" },
    });
    this.request = options.request;
    this.tools = options.tools || [];
  }

  async requestAI(
    content: string | { role: "user"; content: unknown },
    emits: Emits,
  ) {
    const index = this.cacheIndex++;
    const planningAgent = new PlanningAgent({
      request: new ApiRequestClient(this.request),
      // @ts-ignore
      tools: this.tools.map((Tool) => Tool()),
      system: this.system,
      emits,
    });

    await planningAgent.execute(content);

    this.cacheMessages[index] = planningAgent.getMessages();
  }
}

class Rxai2 {
  private system: System;
  private request: ApiRequestClient;
  private messages: ChatMessages = [];
  private tools: Tool[];
  private planList: string[] = [];
  private planMessages: ChatMessages = [];

  constructor(options: RxaiOptions) {
    this.request = new ApiRequestClient(options.request);
    this.system = options.system || { title: "MyBricks.ai" };
    this.tools = options.tools || [];
  }

  async requestAI(content: string, emits: Emits) {
    this.request.setRequestConfig({ emits });
    this.messages.push({ role: "user", content });
    this.planMessages = [];
    this.planMessages.push({ role: "user", content });
    await this.getPlanList();
    console.log("this.planList", this.planList);
    this.planMessages.push({
      role: "assistant",
      content: `已规划出实现需求的完整步骤，将按顺序执行以下工具，${JSON.stringify(this.planList)}`,
    });
    await this.executePlanList();
  }

  private async getPlanList() {
    const response = await this.request.requestAsStream([
      {
        role: "system",
        content: getSystemPrompt({
          title: this.system.title,
          tools: this.tools,
        }),
      },
      ...this.messages,
    ]);

    if (response.type === "complete") {
      const match = response.content!.match(
        /file="planList\.json"[\s\S]*?(\[[\s\S]*?\])/,
      );

      if (match?.[1]) {
        // 正常返回计划列表，执行act
        // TODO: 解析失败的重试
        this.planList = JSON.parse(match[1]);
        return true;
      }
    } else {
      console.log("TODO: 失败重试，没有步骤重试等");
    }
  }

  private async executePlanList() {
    while (this.planList.length) {
      const plan = this.planList.shift();
      const tool = this.tools.find((tool) => {
        return tool.name === plan;
      })!;

      this.planMessages.push({
        role: "user",
        content: `调用工具（${plan} - ${tool.description}）`,
      });

      const response = await this.request.requestAsStream(
        [
          {
            role: "system",
            content: tool.systemPrompt,
          },
          ...this.planMessages,
        ],
        tool,
      );

      if (response.type === "complete") {
        const content = tool!.streamEnd(
          { text: response.content },
          {
            read() {
              return "";
            },
            write() {},
            error() {},
          },
        );
        this.messages.push({ role: "user", content: `调用工具（${plan}）` });
        this.messages.push({ role: "assistant", content });

        this.planMessages.push({ role: "assistant", content });
      }
    }
  }

  // async requestAI(content: string, emits: Emits) {
  //   this.request.setRequestConfig({ emits });
  //   this.planningAgent.run(content);
  // }
}

// class Rxai extends ToolCallAgent {
//   private planningAgent: PlanningAgent;
//   constructor(config: RxaiConfig) {
//     const options = {
//       request: new ApiRequestClient(config.request),
//       tools: config.tools || [],
//       system: config.system || { title: "MyBricks.ai", prompt: "" },
//     };
//     super(options);
//     this.planningAgent = new PlanningAgent(options);
//   }

//   requestAI(content: string, emits: Emits) {
//     this.request.setRequestConfig({ emits });
//     // this.run(content);
//     this.planningAgent.run(content);
//   }
// }

export { Rxai };
