interface FileFormatParams {
  fileName: string;
  content: string;
}

const fileFormat = (params: FileFormatParams) => {
  const { fileName, content } = params;
  const suffix = fileName.split(".").pop();
  return `
  \`\`\`${suffix} file="${fileName}"
  ${content}
  \`\`\`
  `;
};

export { fileFormat };
