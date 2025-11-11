import { Rxai, RegisterParams, RequestParams } from "../agentnext/rxai";

const rxai = new Rxai();

const register = (params: RegisterParams) => {
  rxai.register(params);
};

const requestAI = (params: RequestParams) => {
  rxai.requestAI(params);
};

export { register, requestAI };
export * from "../prompt/base";
