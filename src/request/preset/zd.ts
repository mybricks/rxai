const requestAsStream = async (params: {
  messages: ChatMessages;
  emits: Emits;
  aiRole?: AiRole;
}) => {
  const { messages, emits } = params;
  const { cancel, write, complete, error } = emits;

  try {
    const controller = new AbortController();
    const streamUrl = "https://lego.corp.kuaishou.com/gateway/langbridge/model/service/stream";

    fetch(streamUrl, {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model: "claude-4-sonnet",
        messages,
        bizKey: 'zhida',
        maxTokens: 50000,
      }),
    }).then(async (response: any) => {
      cancel(() => {
        //注册回调
        controller.abort(); //取消请求
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        if (chunk.startsWith('event:error')) {
          throw new Error(`Stream processing error: ${chunk}`);
        }

        // 使用正则表达式分割消息，保留结尾的换行符
        const messages = buffer.split(/\n(?=data:)/);
        
        // 处理除最后一条外的所有完整消息
        buffer = messages.pop() || ''; // 保存最后一条可能不完整的消息

        for (const message of messages) {
          if (message.trim()) {
            const lines = message.trim().split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                try {
                  const jsonStr = line.slice(5).trim();
                  if (jsonStr) {
                    const data = JSON.parse(jsonStr);
                    // 写入解析后的数据内容
                    const content = data?.data?.choices?.[0]?.message?.content || '';
                    if (content) {
                      write(content);
                    }
                  }
                } catch (e: any) {
                  console.error(`Failed to parse SSE data: ${e.message}`);
                }
              }
            }
          }
        }
      }

      complete("");
    });
  } catch (ex) {
    error(ex as Error);
  }
};

export { requestAsStream };