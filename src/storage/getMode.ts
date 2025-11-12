import { STORAGE_MODE_KEY } from "../constant";

const getMode = (): Mode => {
  return (localStorage.getItem(STORAGE_MODE_KEY) as Mode) || "development";
};

export { getMode };
