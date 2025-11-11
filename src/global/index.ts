import { Rxai, RegisterParams, RequestParams } from "../agentnext/rxai";
import { parseFileBlocks } from "../tool/util";

const rxai = new Rxai();

let mockFn: (() => string) | null = null;

const register = (params: RegisterParams) => {
  rxai.register(params);
};

const requestAI = (params: RequestParams) => {
  if (mockFn) {
    params.execute({
      files: parseFileBlocks(mockFn()),
    });
  } else {
    rxai.requestAI(params);
  }
};

const mock = (fn: () => string) => {
  mockFn = fn;
};

export { register, requestAI, mock };
export * from "../prompt/base";
