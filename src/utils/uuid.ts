const uuid = () => {
  return (
    crypto?.randomUUID?.() ||
    `${new Date().getTime()}-${Math.random()}`.replace("0.", "")
  );
};

export { uuid };
