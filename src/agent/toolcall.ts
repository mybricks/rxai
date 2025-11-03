import { ReActAgent } from "./react";
import { AgentState, BaseAgentConfig } from "./base";

export class ToolCallAgent extends ReActAgent {
  protected pendingFunctionCall: { name: string; arguments: string } | null =
    null;
  protected toolCallId: string | null = null;
  constructor(options: BaseAgentConfig) {
    super(options);
  }

  protected async think(): Promise<boolean> {
    console.log("思考返回是否需要使用工具");

    try {
      const response = await this.llm.askTool({
        messages: this.messages,
        tools: this.tools.toParams(),
      });

      console.log("[response]", response);

      if (response.functionCall) {
        this.pendingFunctionCall = response.functionCall;
        const toolCallId = `call_${Date.now()}`;
        this.toolCallId = toolCallId;
        this.messages.push({
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: {
                name: response.functionCall.name,
                arguments: response.functionCall.arguments,
              },
            },
          ],
        });

        return true;
      } else if (response.content !== undefined) {
        this.messages.push({
          role: "assistant",
          content: response.content,
        });

        this.state = AgentState.FINISHED;

        return false;
      }

      return false;
    } catch (error) {
      console.error("[think]", error);
      return false;
    }
  }

  protected async act(): Promise<string> {
    console.log("调用工具", this.pendingFunctionCall);
    if (!this.pendingFunctionCall) {
      return "No pending action.";
    }

    const { name, arguments: args } = this.pendingFunctionCall;

    let toolResult = "";

    try {
      const toolArgs = args ? JSON.parse(args) : {};

      toolResult = await this.tools.execute(name, toolArgs);

      console.log("[toolResult]", toolResult);
    } catch (error) {
      console.error("[act]", error);

      toolResult = `Error: ${error.toString()}`;
    }

    this.messages.push({
      role: "tool",
      tool_call_id: this.toolCallId || `call_${Date.now()}`, // 使用think方法中存储的工具调用ID
      content: toolResult,
    });

    this.pendingFunctionCall = null;
    return toolResult;
  }
}
