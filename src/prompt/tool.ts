const getToolPrompt = (tool: Tool) => {
  return `<工具总览>
你是一个可被调用的工具（${tool.name}），用于${tool.description}。
请按照下述工具详细描述，完成工具调用。
${tool.getPrompts()}
</工具总览>
`;
};

export { getToolPrompt };
