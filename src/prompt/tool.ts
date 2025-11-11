const getToolPrompt = (tool: Tool) => {
  return `<当前调用工具描述>
你是一个可被调用的工具（${tool.name}），用于${tool.description}。
请按照下述工具详细描述，完成工具调用。
${tool.getPrompts()}
</当前调用工具描述>
`;
};

export { getToolPrompt };
