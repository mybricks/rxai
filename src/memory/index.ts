import {register as registerMemory} from './memory'

export {getPrompts} from './memory'

export function register(args: RegisterOptions) {
  registerMemory(args)
}
