/* eslint-disable @typescript-eslint/ban-ts-comment */
import { Rxai } from "../agent/rxai";

const getHistoryRecords = (): Tool => {
  return {
    name: "get-history-records",
    displayName: "读取历史对话记录",
    description: `读取历史对话记录，用于后续完成需求使用，作为后续工具调用的上下文信息。
参数(filenames)：历史对话记录文件名列表，支持批量，批量文件名用英文逗号分隔；

**历史记录读取决策流程**
1. 首先检查：用户是否使用了指代词？（那个、它、之前的、刚才的等）
  - 是 → 必须读取历史记录
  - 否 → 继续下一步

2. 其次检查：用户是否表达了对之前结果的不满？（错了、不对、重做等）
  - 是 → 必须读取历史记录了解问题根源
  - 否 → 继续下一步

3. 最后检查：当前任务是否需要上下文信息才能理解？
  - 是 → 读取相关历史记录
  - 否 → 可直接处理

**强制读取历史记录的触发词汇**
- 明确引用类：重试、继续、按照之前、根据刚才、基于上次
- 指代类：那个、它们、该文档、此方案
- 否定重做类：搞错了、不对、全错了、重新来、没实现
- 状态查询类：进展如何、结果怎样、完成了吗

**历史文件读取优先级**
1. 高优先级：包含用户明确提及的关键词的对话记录
2. 中优先级：最近3轮对话记录（时间相关性）
3. 禁止行为：不得基于推测构造不存在的文件名
4. 注意：一定要从最近的对话记录开始往前找，找全与本次相关联的历史对话记录

**完整性检查增强要求**
在进行完整性检查时，必须回答以下问题：
1. 用户的需求是否包含指代性词汇？
2. 当前任务是否依赖之前的操作结果？
3. 如果需要历史记录，是否已在规划中包含get-history-records？
4. 所读取的历史文件是否足以支撑后续操作？

**决策前自我质疑**
在确定工作模式前，agent必须自问：
- "用户的表述中是否有我无法直接理解的部分？"
- "这些不明确的部分是否可能在历史对话中找到答案？"
- "如果我不读取历史记录，我的回答是否可能偏离用户真实意图？"

只有在确认"即使读取历史记录也无法获得有用信息"时，才可跳过历史记录读取。
`,
    //   description: `读取历史对话记录，用于后续完成需求使用，作为后续工具调用的上下文信息。
    // 参数(filenames)：历史对话记录文件名列表，支持批量，批量文件名用英文逗号分隔；

    // 何时使用：任何提问，都应该先检索历史对话记录，有可能需要参考历史对话记录里的信息来理解当前需求。

    // **历史对话记录读取策略**
    // 1. **用户明确引用历史内容**：如"重试"、"按照之前的xxx"、"刚才xxx"等
    // 2. **用户表达不满或要求重做**：如"全是错的"、"没实现"、"搞错了"等
    // 3. **用户使用代词指代**：如"这个"、"那个"、"它"等，需要通过历史对话记录确定指代对象
    // 4. **任务存在上下文依赖**：当前任务需要了解之前的操作结果或设置
    // 5. **用户需求难以理解时**：去历史对话记录检索可能关联的信息
    // 6. **只需要相关联的**：禁止总是读取所有历史对话记录，只读取相关联的历史对话记录
    // 7. **当需要查看工具调用记录和返回内容时**：

    // **文件读取前置条件**
    // - **仅读取明确列出的文件**：只能读取历史对话记录里明确提供的历史对话记录文件
    // - **验证文件存在性**：确保目标文件在历史对话记录中
    // - **禁止猜测文件名**：严禁基于推测或假设来构造文件名进行读取`,
    // @ts-ignore
    execute({ params }) {
      const { filenames } = params as { filenames: string };
      // const planningAgentsMap: any = {};
      // const planningAgents = filenames.split(",").forEach((filename) => {
      //   const agent = rxai.fileNameMap[filename];
      //   if (agent) {
      //     planningAgentsMap[agent.planningAgent.id] = agent.planningAgent;
      //   }
      //   // return rxai.fileNameMap[filename];
      // });
      // .filter(Boolean)
      // .sort((a, b) => a.index - b.index);

      return filenames.split(",");

      // console.log("[planningAgents]", planningAgents);

      // if (!planningAgents.length) {
      //   return {
      //     llmContent: "没有历史对话记录",
      //     displayContent: "没有历史对话记录",
      //   };
      // }

      // return {
      //   llmContent: "读取的内容，写历史记录",
      //   displayContent: "已读取历史对话记录",
      // };
    },
  };
};

export { getHistoryRecords };
