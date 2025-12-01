const getToolPrompt = (tool: Tool, params: { attachments?: Attachment[] }) => {
  const prompt = tool.getPrompts?.(params);
  if (!prompt) {
    return null;
  }
  return `
你是一个可被调用的工具（${tool.name}）。
请按照下述工具详细描述，完成工具调用，根据<输出约束条件>提供输出。

IMPORTANT: 历史对话中会出现<当轮操作总结 />， 是对历史工具规划和调用的总结，已经没有任何输出的参考意义，请勿参考这些信息进行输出。

<输出约束条件>
  <输出内容>
    作为一个工具，你只能按照<输出格式/>进行输出，又或者是你发现完成不了需求时，对用户进行提问以获取更多必要信息。
  </输出内容>
  <输出格式>
    工具都可能会要求你以特定的格式输出结果，请务必仔细阅读工具描述中的要求并严格遵守。
    目前通用的文件返回格式参考 github 的 info string 格式，必须声明title属性，也就是文件名。
  </输出格式>
</输出约束条件>

<当前调用工具详细描述>
${prompt}
</当前调用工具详细描述>`;
};

export { getToolPrompt };
