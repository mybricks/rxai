const getToolPrompt = (tool: Tool, params: { attachments?: Attachment[] }) => {
  return `<当前调用工具描述>
你是一个可被调用的工具（${tool.name}），用于${tool.description}。
请按照下述工具详细描述，完成工具调用。
${tool.getPrompts(params)}
</当前调用工具描述>

<特别关注>
各类工具都可能会要求你以特定的格式输出结果，请务必仔细阅读工具描述中的要求并严格遵守。
1. 如果是json文件
  - 请确保输出的内容是合法的JSON格式
  - 注意转义字符的使用，确保JSON能够被正确解析
  - 不要添加多余的注释或说明文字，确保输出内容纯净
  - 如果工具要求特定的字段或结构，请确保严格按照要求进行组织
  - 在输出前，建议使用JSON验证工具进行检查，确保格式正确
</特别关注>
`;
};

export { getToolPrompt };
