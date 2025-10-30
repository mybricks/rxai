export default {
  getAvailable() {
    return new Promise(resolve => {
      resolve({
        times: 200
      })
    })
  },
  requestAsStream(messages, {
    write,
    complete,
    error,
    cancel
  }, {aiRole}) {
    // write(result)////TODO
    // complete()
    // return

//debugger

    try {
      let model = 'openai/gpt-4o-mini-2024-07-18'
      model = 'deepseek-chat'
      model = `deepseek/deepseek-r1-0528`
      model = `google/gemini-2.5-pro`

      model = `openai/gpt-oss-120b`
      model = `openai/gpt-5-mini`


      let top_p = 0.4, temperature = 0.4
      //let model = 'openai/gpt-4o'
      if (aiRole === 'imageCreator') {
        model = `google/gemini-2.5-flash-image`
      } else if (aiRole === 'image') {
        model = `anthropic/claude-3.7-sonnet`
        model = `google/gemini-2.5-pro-preview`
        model = `anthropic/claude-sonnet-4`
      } else if (aiRole === 'architect') {
        //temperature = 0.8
        model = 'openai/gpt-4o-2024-11-20'
        model = `deepseek/deepseek-r1-0528`
        model = `google/gemini-2.5-pro`
      } else if (aiRole === 'expert') {
        model = `anthropic/claude-3.5-sonnet:beta`
        model = `google/gemini-2.5-pro-preview`
        model = `deepseek/deepseek-r1-0528`
        model = `anthropic/claude-sonnet-4`
      }

      const controller = new AbortController();
      fetch('http://ai.mybricks.world/stream-test', {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages,
          //tools,
          // tool_choice: tools ? {
          //   type: "function",
          //   function: {name: "get_com_docs"}
          // } : void 0,
          //tool_choice: tools ? 'required' : void 0,
          //tool_choice: tools ? 'auto' : void 0,
          //model: "openai/gpt-4o-mini",
          // temperature,
          // top_p,
          // n:2
          model,
          //model:'anthropic/claude-3.5-sonnet'
        })
      }).then(async response => {
        cancel(() => {//注册回调
          controller.abort()//取消请求
        })

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const {done, value} = await reader.read()

          if (done) {
            break
          }

          const chunk = decoder.decode(value, {stream: true});
          write(chunk)
        }

        complete()
      })
    } catch (ex) {
      error(ex)
    }
  }
}