const getToolPrompt = (tool: Tool, params: { attachments?: Attachment[] }) => {
  if (!tool.getPrompts) {
    return null;
  }
  return `<当前调用工具描述>
你是一个可被调用的工具（${tool.name}），用于${tool.description}。
请按照下述工具详细描述，完成工具调用。
${tool.getPrompts(params)}

<输出时特别关注>
工具都可能会要求你以特定的格式输出结果，请务必仔细阅读工具描述中的要求并严格遵守。

目前通用的返回格式参考 github 的 info string 格式，支持代码块中声明title属性，也就是文件名。
</输出时特别关注>

</当前调用工具描述>`;
};

export { getToolPrompt };
