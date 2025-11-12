import { Rxai, RegisterParams, RequestParams } from "../agent/rxai";
import { parseFileBlocks } from "../tool/util";
import { requestAsStream } from "../request/preset/mybricks";

let rxai: Rxai;

let mockFn:
  | (() => {
      toolName: string;
      result: string;
      key: string;
    })
  | null = null;

const ensure = () => {
  if (!rxai) {
    rxai = new Rxai({
      request: {
        requestAsStream: requestAsStream,
      },
    });
  }
};

const register = (params: RegisterParams) => {
  ensure();
  rxai.register(params);
};

const requestAI = (params: RequestParams) => {
  ensure();
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

const mock = (fn: typeof mockFn) => {
  mockFn = fn;
};

export { register, requestAI, mock };
export * from "../prompt/base";
