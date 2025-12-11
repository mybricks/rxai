/**
 * 解析代码块字符串，提取文件信息和内容
 * @param {string} content - 包含代码块的字符串
 * @returns {Array} 解析结果数组
 */
export function parseFileBlocks(content: string) {
  const results = [];
  let currentIndex = 0;

  let resultContent = content;

  while (currentIndex < content.length) {
    // 查找代码块开始标记，支持多种格式：
    // 1. ```language file="filename"
    // 2. ```language title="filename"
    // 3. ```language
    // 4. ```
    const startPattern = /```(?:(\w+)(?:\s+(?:file|title)="([^"]+)")?)?\s*\n/g;
    startPattern.lastIndex = currentIndex;

    const startMatch = startPattern.exec(content);
    if (!startMatch) {
      break; // 没有更多代码块
    }

    const [startFullMatch, language, fileName] = startMatch;
    const contentStartIndex = startMatch.index + startFullMatch.length;

    // 查找代码块结束标记
    const endPattern = /\n```/g;
    endPattern.lastIndex = contentStartIndex;

    const endMatch = endPattern.exec(content);
    let blockContent;
    let isComplete;

    if (endMatch) {
      // 找到完整的结束标记
      blockContent = content.substring(contentStartIndex, endMatch.index + 1); // +1 包含换行符
      isComplete = true;
      currentIndex = endMatch.index + endMatch[0].length;
    } else {
      // 没有找到结束标记，取到字符串末尾
      blockContent = content.substring(contentStartIndex);

      // 清理可能的不完整结束标记
      blockContent = blockContent.replace(/\n\s*`{1,2}$/, "\n");

      isComplete = false;
      currentIndex = content.length;
    }

    // 生成文件名和解析文件信息
    let finalFileName = fileName || "";
    let name = "";
    let extension = "";

    if (finalFileName) {
      // 有明确的文件名
      const lastDotIndex = finalFileName.lastIndexOf(".");
      name =
        lastDotIndex !== -1
          ? finalFileName.substring(0, lastDotIndex)
          : finalFileName;
      extension =
        lastDotIndex !== -1 ? finalFileName.substring(lastDotIndex + 1) : "";
    } else if (isComplete) {
      // 只有在代码块完整时才生成默认文件名
      if (language) {
        const extensionMap: { [key: string]: string } = {
          javascript: "js",
          typescript: "ts",
          python: "py",
          java: "java",
          html: "html",
          css: "css",
          json: "json",
          xml: "xml",
          yaml: "yml",
          yml: "yml",
          markdown: "md",
          md: "md",
          shell: "sh",
          bash: "sh",
          sql: "sql",
          php: "php",
          ruby: "rb",
          go: "go",
          rust: "rs",
          swift: "swift",
          kotlin: "kt",
        };

        extension = extensionMap[language.toLowerCase()] || language;
        finalFileName = `code_block_${results.length + 1}.${extension}`;
        name = `code_block_${results.length + 1}`;
      } else {
        // 既没有语言也没有文件名
        finalFileName = `code_block_${results.length + 1}.txt`;
        name = `code_block_${results.length + 1}`;
        extension = "txt";
      }
    }

    let startIndex = -1;

    if (startMatch) {
      startIndex = startMatch.index;
    }

    let endIndex = undefined;
    if (endMatch) {
      endIndex = endMatch.index;
    }

    if (startIndex !== -1) {
      resultContent = resultContent.replace(
        resultContent.slice(startIndex, currentIndex),
        fileName,
      );
    }

    results.push({
      fileName: finalFileName,
      name: name,
      extension: extension,
      language: language || "",
      content: blockContent,
      isComplete: isComplete,
    });
  }

  // 去除所有可能的代码块（包括不完整的，适配流式返回）
  // 1. 匹配完整的代码块：```...```
  // 2. 匹配不完整的代码块开始：```...（到字符串末尾）
  // 3. 清理剩余的单独的反引号：` 或 `` 或 ```
  const cleanedContent = resultContent
    // 先匹配完整的代码块（从 ``` 到 ```，非贪婪匹配）
    .replace(/```[\s\S]*?```/g, "")
    // 再匹配不完整的代码块开始（从 ``` 到字符串末尾）
    .replace(/```[\s\S]*$/g, "")
    // 最后清理可能残留的单独反引号（1-3个连续的 `）
    .replace(/`{1,3}/g, "");

  return {
    content: cleanedContent,
    files: results,
  };
}
