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
    params.execute({
      toolName: mock.toolName,
      files: parseFileBlocks(mock.result),
    });
  } else {
    rxai.requestAI(params);
  }
};

const mock = (fn: () => { toolName: string; result: string }) => {
  mockFn = fn;
};

export { register, requestAI, mock };
export * from "../prompt/base";
