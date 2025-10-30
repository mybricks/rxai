type RegisterOptions = {
  name: string,
  description: string
}

type RequestOptions = {
  registerName:string,
  message:string,
  attachmentAry: Array<{
    base64: string,
  }>
}