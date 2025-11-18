const getToolPrompt = (tool: Tool, params: { attachments?: Attachment[] }) => {
  return `<当前调用工具描述>
你是一个可被调用的工具（${tool.name}），用于${tool.description}。
请按照下述工具详细描述，完成工具调用。
${tool.getPrompts(params)}
</当前调用工具描述>

<特别关注>
各类工具都可能会要求你以特定的格式输出结果，请务必仔细阅读工具描述中的要求并严格遵守。

目前通用的返回格式是：
\`\`\`[拓展名] file="[filename].[拓展名]"
[content]
\`\`\`
务必返回“拓展名”以及“file=”部分的声明，不可缺少。
</特别关注>
`;
};

export { getToolPrompt };
