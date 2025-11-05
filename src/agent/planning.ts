// import { ReActAgent } from "./react";
// import { AgentState, BaseAgentConfig } from "./base";
// import { getSystemPrompt } from "../prompt/planning";

// class PlanningAgent extends ReActAgent {
//   steps: { name: string; done: boolean }[] = [];
//   stepIndex: number = 0;
//   constructor(options: BaseAgentConfig) {
//     super(options);
//   }

//   protected async think(): Promise<boolean> {
//     const response = await this.request.requestAsStream([
//       {
//         role: "system",
//         content: getSystemPrompt({
//           title: this.system.title,
//           tools: this.tools,
//         }),
//       },
//       ...this.messages,
//     ]);

//     if (response.type === "complete") {
//       const match = response.content!.match(
//         /file="planList\.json"[\s\S]*?(\[[\s\S]*?\])/,
//       );

//       this.state = AgentState.FINISHED;

//       if (match?.[1]) {
//         // 正常返回计划列表，执行act
//         this.steps = JSON.parse(match[1]);

//         // TODO: 解析失败的重试
//         return true;
//       }
//     } else {
//       console.log("TODO: 失败的话重试，没有步骤的话重试等");
//       this.state = AgentState.FINISHED;
//     }
//     return false;
//   }

//   protected async act(): Promise<string> {
//     console.log("[开始执行计划]", this.steps);

//     // while (this.stepIndex < this.steps.length) {
//     //   const step = this.steps[this.stepIndex];
//     //   const tool = this.tools.find((tool) => {
//     //     return tool.name === step.name;
//     //   });

//     //   this.
//     // }

//     return "";
//   }
// }

// export { PlanningAgent };

import { ApiRequestClient } from "../request";
import { Tool, RxToolContext } from "../tool/base";
import { getSystemPrompt } from "../prompt/planning";

interface BaseSystem {
  title: string;
}
interface BaseAgentOptions {
  // request: ApiRequestClient;
  // tools: (typeof Tool)[];
  system: BaseSystem;
}

abstract class BaseAgent {
  protected messages: ChatMessages = [];
  // protected request: ApiRequestClient;
  // protected tools: (typeof Tool)[];
  protected system: BaseSystem;

  constructor(options: BaseAgentOptions) {
    // this.request = options.request;
    // this.tools = options.tools;
    this.system = options.system;
  }

  // abstract run(content: unknown): Promise<void>;
}

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  request: ApiRequestClient;
  tools: Tool[];
}

/**
 * 分析计划
 * 执行计划
 */
class PlanningAgent extends BaseAgent {
  planList: { name: string; done: boolean; pending: boolean }[] = [];
  planIndex: number = 0;
  private request: ApiRequestClient;
  private tools: Tool[];
  private emits: Emits;

  constructor(options: PlanningAgentOptions) {
    super(options);
    this.request = options.request;
    this.tools = options.tools;
    this.emits = options.emits;
  }

  getMessages() {
    return this.messages;
  }

  async execute(content: string | ChatMessages[number]) {
    // 推送用户需求
    if (typeof content === "string") {
      this.messages.push({ role: "user", content });
    } else {
      this.messages.push(content);
    }

    const hasPlanList = await this.getPlanList();
    if (hasPlanList) {
      this.messages.push({
        role: "assistant",
        content: `已规划出实现需求所需的完整步骤，将按顺序执行以下工具，${JSON.stringify(this.planList)}`,
      });
    }
    await this.executePlanList();
  }

  private async getPlanList() {
    const emitsProxy: Emits = {
      write: (chunk) => {
        this.emits.write(chunk);
      },
      complete: () => {},
      error: (error) => {
        this.emits.error(error);
      },
      cancel: (fn) => {
        this.emits.cancel(fn);
      },
    };
    const response = await this.request.requestAsStream(
      [
        {
          role: "system",
          content: getSystemPrompt({
            title: this.system.title,
            tools: this.tools,
          }),
        },
        ...this.messages,
      ],
      emitsProxy,
    );

    if (response.type === "complete") {
      const match = response.content!.match(
        /file="planList\.json"[\s\S]*?(\[[\s\S]*?\])/,
      );

      if (match?.[1]) {
        // 正常返回计划列表，执行act
        // TODO: 解析失败的重试
        this.planList = JSON.parse(match[1]).map((plan: string) => {
          return {
            name: plan,
            done: false,
            pending: false,
          };
        });
        console.log(
          "[PlanningAgent - planList]",
          JSON.parse(JSON.stringify(this.planList)),
        );
        return true;
      }
    } else {
      console.log("[PlanningAgent - 请求结果 - 失败/取消]", response);
    }
  }

  private async executePlanList() {
    while (this.planList.length) {
      const plan = this.planList.shift();
      const tool = this.tools.find((tool) => {
        return tool.name === plan!.name;
      })!;

      this.messages.push({
        role: "user",
        content: `调用工具（${tool.name} - ${tool.description}）`,
      });

      const isLastPlan = !this.planList.length;

      const rxToolContext: RxToolContext = {
        read() {
          return "";
        },
        write() {},
        error() {},
      };

      const emitsProxy: Emits = {
        write: (chunk) => {
          this.emits.write(chunk);
          tool.streaming({ text: chunk }, rxToolContext);
        },
        complete: () => {
          if (isLastPlan) {
            // 最后一个工具完成后，认为最终完成
            this.emits.complete(this.messages);
          }
        },
        error: (error) => {
          this.emits.error(error);
          tool.streamError(error, rxToolContext);
        },
        cancel: (fn) => {
          this.emits.cancel(fn);
        },
      };

      tool!.streamStart();

      const response = await this.request.requestAsStream(
        [
          {
            role: "system",
            content: tool.systemPrompt,
          },
          ...this.messages,
        ],
        emitsProxy,
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
        this.messages.push({ role: "assistant", content });
      }
    }
  }
}

export { PlanningAgent, BaseAgent, BaseAgentOptions };
