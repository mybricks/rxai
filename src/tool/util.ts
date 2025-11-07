/**
 * 解析代码块字符串，提取文件信息和内容
 * @param {string} content - 包含代码块的字符串
 * @returns {Array} 解析结果数组
 */
export function parseFileBlocks(content: string) {
  const results = [];
  let currentIndex = 0;

  while (currentIndex < content.length) {
    // 查找代码块开始标记
    const startPattern = /```(\w+)\s+type="([^"]+)"\s+file="([^"]+)"\s*\n/g;
    startPattern.lastIndex = currentIndex;

    const startMatch = startPattern.exec(content);
    if (!startMatch) {
      break; // 没有更多代码块
    }

    const [startFullMatch, language, type, fileName] = startMatch;
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

    // 解析文件名
    const lastDotIndex = fileName.lastIndexOf(".");
    const name =
      lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
    const extension =
      lastDotIndex !== -1 ? fileName.substring(lastDotIndex + 1) : "";

    results.push({
      fileName: fileName,
      name: name,
      extension: extension,
      type: type,
      language: language,
      content: blockContent,
      isComplete: isComplete,
    });
  }

  return results;
}
