import { Rxai, RegisterParams, RequestParams } from "../agentnext/rxai";
import { parseFileBlocks } from "../tool/util";

const rxai = new Rxai();

let mockFn: (() => any) | null = null;

const register = (params: RegisterParams) => {
  rxai.register(params);
};

const requestAI = (params: RequestParams) => {
  if (mockFn) {
    const mock = mockFn();
    const tool = Object.entries(rxai.scenes)
      .reduce((pre, [, value]) => {
        pre.push(...value.tools);
        return pre;
      }, [] as Tool[])
      .find((tool) => tool.name === mock.toolName);

    if (tool) {
      tool.execute({
        files: parseFileBlocks(mock.result),
        key: mock.key,
      });
    } else {
      console.error(`Tool「${mock.toolName}」not found`);
    }
  } else {
    rxai.requestAI(params);
  }
};

const mock = (fn: () => { toolName: string; result: string }) => {
  mockFn = fn;
};

export { register, requestAI, mock };
export * from "../prompt/base";
