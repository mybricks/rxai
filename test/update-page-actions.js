let mockActions = [];

async function executeActionsWithDelay(pageId, actions, delay, api) {
  // 开始执行
  await api.updatePage(pageId, [], "start");

  // 遍历执行每个action
  for (let i = 0; i < actions.length; i++) {
    // 添加延迟
    await new Promise((resolve) => setTimeout(resolve, delay));

    // 执行当前action
    await api.updatePage(pageId, [actions[i]], "ing");
  }

  // 最后调用空数组，参数为complete
  await new Promise((resolve) => setTimeout(resolve, delay));
  await api.updatePage(pageId, [], "complete");
}

executeActionsWithDelay(
  "u_l3x7M",
  mockActions,
  200,
  window.plugin_ai_context.api?.page?.api,
);
