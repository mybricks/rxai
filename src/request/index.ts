import global from "./global";

export function requestAI(messageAry, emits, aiRole?) {
  const emitsProxy = {
    write(chunk) {
      // if (ifCanceled()) {
      //   return
      // }

      emits.write(chunk)
    },
    complete() {
      // if (ifCanceled()) {
      //   return
      // }

      emits.complete()
    },
    error(ex) {
      // if (ifCanceled()) {
      //   return
      // }

      emits.error(ex)
    },
    cancel(fn) {
      //nowMsg.cancelRequest = fn
    }
  }

  global.requestAsStream(messageAry, emitsProxy, {aiRole})

}