const Register = {}

export function getPrompts(): string {
  const prompts = []

  Object.keys(Register).forEach(name => {
    const item = Register[name]
    prompts.push(
      {
        name,
        description: item.description,
      }
    )
  })

  return prompts.map(item => {
    return JSON.stringify(item, null, 2)
  }).join(`\n`)
}

export function register(args: RegisterOptions) {
  Register[args.name] = args
}