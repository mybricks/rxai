import { ApiRequestClient } from "../requestnext";
// import { Tool, RxToolContext } from "../tool/base";
import { getSystemPrompt } from "../prompt/planning";
import { BaseAgent, BaseAgentOptions } from "./base";
import { parseFileBlocks } from "../tool/util";
import { getToolPrompt } from "../prompt/tool";

interface PlanningAgentOptions extends BaseAgentOptions {
  emits: Emits;
  request: ApiRequestClient;
  tools: Tool[];
  key: string;
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
  private key: string;

  constructor(options: PlanningAgentOptions) {
    super(options);
    this.request = options.request;
    this.tools = options.tools;
    this.emits = options.emits;
    this.key = options.key;
  }

  getMessages() {
    return this.messages;
  }

  async run(content: string | ChatMessages[number]) {
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
    const messages = [
      {
        role: "system",
        content: getSystemPrompt({
          title: this.system.title,
          tools: this.tools,
        }),
      },
      ...this.messages,
    ];
    const response = await this.request.requestAsStream(
      messages,
      emitsProxy,
      {},
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

      const emitsProxy: Emits = {
        write: (chunk) => {
          this.emits.write(chunk);
        },
        complete: (content) => {
          if (isLastPlan) {
            // 最后一个工具完成后，认为最终完成
            this.emits.complete(content);
          }
        },
        error: (error) => {
          this.emits.error(error);
        },
        cancel: (fn) => {
          this.emits.cancel(fn);
        },
      };

      const messages = [
        {
          role: "system",
          content: getToolPrompt(tool),
        },
        ...this.messages,
      ];
      const response = await this.request.requestAsStream(
        messages,
        emitsProxy,
        { aiRole: tool.aiRole },
      );

      if (response.type === "complete") {
        const files = parseFileBlocks(response.content);
        const content = tool.execute({
          files,
          key: this.key,
        });
        this.messages.push({ role: "assistant", content });
      }
    }
  }
}

export { PlanningAgent };
