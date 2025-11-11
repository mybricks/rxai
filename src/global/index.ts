import { Rxai, RegisterParams, RequestParams } from "../agentnext/rxai";
import { parseFileBlocks } from "../tool/util";

const rxai = new Rxai();

let mockFn: (() => any) | null = null;

const register = (params: RegisterParams) => {
  rxai.register(params);
};

const requestAI = (params: RequestParams) => {
  if (mockFn) {
    params.execute(mockFn());
  } else {
    rxai.requestAI(params);
  }
};

const mock = (params: { toolName: string; result: string }) => {
  mockFn = () => {
    return {
      toolName: params.toolName,
      files: parseFileBlocks(params.result),
    };
  };
};

export { register, requestAI, mock };
export * from "../prompt/base";
