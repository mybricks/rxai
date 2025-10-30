import {requestAI} from "../request";
import getSystemPrompts from "./getSystemPrompts";

export function request(args: RequestOptions) {

  const {registerName, message, attachmentAry} = args

  const systemPrompts = getSystemPrompts()

  const messages = [
    {
      content: systemPrompts,
      role: 'system'
    },
    {
      content: args.message,
      role: 'user'
    }
  ]

  const emits = {
    write(chunk) {
      console.log(chunk)
    },
    complete() {
      console.log('complete')
    }
  }

  requestAI(messages, emits)
}