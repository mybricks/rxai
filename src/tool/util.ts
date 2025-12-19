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
    // 查找代码块开始标记，支持多种格式和容错
    const startPattern = /```(?:(\w+)(?:\s+(.+?))?)?\s*\n/g;
    startPattern.lastIndex = currentIndex;

    const startMatch = startPattern.exec(content);
    if (!startMatch) {
      break; // 没有更多代码块
    }

    const [startFullMatch, language, attributesPart] = startMatch;
    const contentStartIndex = startMatch.index + startFullMatch.length;

    // 解析文件名，采用严格模式，宁可不要也不要误匹配
    let fileName = "";
    if (attributesPart) {
      fileName = extractFileNameStrict(attributesPart);
    }

    // 查找代码块结束标记
    const endPattern = /\n```/g;
    endPattern.lastIndex = contentStartIndex;

    const endMatch = endPattern.exec(content);
    let blockContent;
    let isComplete;

    if (endMatch) {
      // 找到完整的结束标记
      blockContent = content.substring(contentStartIndex, endMatch.index + 1);
      isComplete = true;
      currentIndex = endMatch.index + endMatch[0].length;
    } else {
      // 没有找到结束标记，取到字符串末尾
      blockContent = content.substring(contentStartIndex);
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
    } else {
      // 没有明确文件名时生成默认文件名
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
        finalFileName,
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

  // 去除所有可能的代码块
  const cleanedContent = resultContent
    .replace(/```[\s\S]*?```/g, "")
    .replace(/```[\s\S]*$/g, "")
    .replace(/`{1,3}/g, "");

  return {
    content: cleanedContent,
    files: results,
  };
}

/**
 * 严格模式提取文件名 - 只从明确的属性中提取，绝不误匹配内容
 * @param {string} attributesPart - 属性部分字符串
 * @returns {string} 提取到的文件名
 */
function extractFileNameStrict(attributesPart: string): string {
  if (!attributesPart) return "";

  // 只匹配明确的 file= 或 title= 属性格式

  // 模式1: file="filename" 或 title="filename" (标准双引号)
  let match = attributesPart.match(/^(?:file|title)="([^"]+)"$/i);
  if (match && match[1]) {
    return cleanFileName(match[1]);
  }

  // 模式2: file='filename' 或 title='filename' (标准单引号)
  match = attributesPart.match(/^(?:file|title)='([^']+)'$/i);
  if (match && match[1]) {
    return cleanFileName(match[1]);
  }

  // 模式3: file=filename 或 title=filename (无引号，但必须是单个词)
  match = attributesPart.match(/^(?:file|title)=([^\s"']+)$/i);
  if (match && match[1]) {
    return cleanFileName(match[1]);
  }

  // 模式4: 处理复杂引号情况，但要非常小心
  // 只处理明确以 file=" 或 title=" 开头的情况
  if (/^(?:file|title)="/i.test(attributesPart)) {
    // 提取从第一个引号到最后一个引号之间的内容
    const startMatch = attributesPart.match(/^(?:file|title)="(.*)$/i);
    if (startMatch && startMatch[1]) {
      let fileName = startMatch[1];

      // 如果以引号结尾，去掉最后的引号
      if (fileName.endsWith('"')) {
        fileName = fileName.slice(0, -1);
      }

      // 只有当提取的内容看起来像文件名时才返回
      if (fileName && (fileName.includes(".") || fileName.length < 50)) {
        return cleanFileName(fileName);
      }
    }
  }

  // 模式5: 处理单引号的复杂情况
  if (/^(?:file|title)='/i.test(attributesPart)) {
    const startMatch = attributesPart.match(/^(?:file|title)='(.*)$/i);
    if (startMatch && startMatch[1]) {
      let fileName = startMatch[1];

      if (fileName.endsWith("'")) {
        fileName = fileName.slice(0, -1);
      }

      if (fileName && (fileName.includes(".") || fileName.length < 50)) {
        return cleanFileName(fileName);
      }
    }
  }

  // 如果都不匹配，返回空字符串，宁可不要也不误匹配
  return "";
}

/**
 * 清理文件名中的无效字符
 * @param {string} fileName - 原始文件名
 * @returns {string} 清理后的文件名
 */
function cleanFileName(fileName: string): string {
  if (!fileName) return "";

  fileName = fileName.trim();

  // 如果文件名过长，可能是误匹配的内容，返回空
  if (fileName.length > 100) {
    return "";
  }

  // 清理无效字符，保留引号
  fileName = fileName.replace(/[<>:|?*]/g, "_");

  if (!fileName || fileName.replace(/_/g, "") === "") {
    return "";
  }

  return fileName;
}

// /**
//  * 测试用例函数
//  */
// function testParseFileBlocks() {
//   console.log("开始测试 parseFileBlocks 函数...\n");

//   const testCases = [
//     {
//       name: "标准格式 - file属性",
//       input: `这是一些文本
// \`\`\`javascript file="app.js"
// console.log("Hello World");
// \`\`\`
// 更多文本`,
//       expected: {
//         filesCount: 1,
//         fileName: "app.js",
//         language: "javascript",
//         isComplete: true,
//       },
//     },
//     {
//       name: "标准格式 - title属性",
//       input: `\`\`\`python title="main.py"
// print("Hello Python")
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "main.py",
//         language: "python",
//         isComplete: true,
//       },
//     },
//     {
//       name: "容错测试 - 引号不匹配1",
//       input: `\`\`\`typescript title="这是"我的.ts"
// export function test() {}
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: `这是"我的.ts`,
//         language: "typescript",
//         isComplete: true,
//       },
//     },
//     {
//       name: "容错测试 - 引号不匹配2",
//       input: `\`\`\`css title="这是"我的页面".css"
// body { margin: 0; }
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: `这是"我的页面".css`,
//         language: "css",
//         isComplete: true,
//       },
//     },
//     {
//       name: "容错测试 - 单引号格式",
//       input: `\`\`\`html file='index.html'
// <h1>Hello</h1>
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "index.html",
//         language: "html",
//         isComplete: true,
//       },
//     },
//     {
//       name: "容错测试 - 无引号格式",
//       input: `\`\`\`json file=config.json
// {"name": "test"}
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "config.json",
//         language: "json",
//         isComplete: true,
//       },
//     },
//     {
//       name: "无文件名 - 自动生成",
//       input: `\`\`\`javascript
// function hello() {
//   return "world";
// }
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "code_block_1.js",
//         language: "javascript",
//         isComplete: true,
//       },
//     },
//     {
//       name: "无语言无文件名",
//       input: `\`\`\`
// some plain text
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "code_block_1.txt",
//         language: "",
//         isComplete: true,
//       },
//     },
//     {
//       name: "不完整代码块",
//       input: `\`\`\`python title="incomplete.py"
// print("This is incomplete"`,
//       expected: {
//         filesCount: 1,
//         fileName: "incomplete.py",
//         language: "python",
//         isComplete: false,
//       },
//     },
//     {
//       name: "容错测试 - 复杂引号错误",
//       input: `\`\`\`typescript title="complex"file"name.ts"
// interface User {
//   name: string;
// }
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "complex", // 应该提取到第一个引号内的内容
//         language: "typescript",
//         isComplete: true,
//       },
//     },
//     {
//       name: "容错测试 - 特殊字符清理",
//       input: `\`\`\`java file="Test<>:|?.java"
// public class Test {}
// \`\`\``,
//       expected: {
//         filesCount: 1,
//         fileName: "Test_____.java", // 特殊字符被替换为下划线
//         language: "java",
//         isComplete: true,
//       },
//     },
//   ];

//   let passedTests = 0;
//   const totalTests = testCases.length;

//   testCases.forEach((testCase, index) => {
//     console.log(`测试 ${index + 1}: ${testCase.name}`);

//     try {
//       const result = parseFileBlocks(testCase.input);

//       // 检查文件数量
//       const filesCountMatch =
//         result.files.length === testCase.expected.filesCount;

//       // 检查第一个文件的属性
//       const firstFile = result.files[0];
//       const fileNameMatch = firstFile?.fileName === testCase.expected.fileName;
//       const languageMatch = firstFile?.language === testCase.expected.language;
//       const isCompleteMatch =
//         firstFile?.isComplete === testCase.expected.isComplete;

//       const allMatch =
//         filesCountMatch && fileNameMatch && languageMatch && isCompleteMatch;

//       if (allMatch) {
//         console.log("✅ 通过");
//         passedTests++;
//       } else {
//         console.log("❌ 失败");
//         console.log("  期望:", testCase.expected);
//         console.log("  实际:", {
//           filesCount: result.files.length,
//           fileName: firstFile?.fileName,
//           language: firstFile?.language,
//           isComplete: firstFile?.isComplete,
//         });
//       }

//       // 显示解析结果的详细信息
//       console.log("  解析结果:", {
//         cleanedContentLength: result.content.length,
//         filesCount: result.files.length,
//         files: result.files.map((f) => ({
//           fileName: f.fileName,
//           name: f.name,
//           extension: f.extension,
//           language: f.language,
//           contentLength: f.content.length,
//           content: f.content,
//           isComplete: f.isComplete,
//         })),
//       });
//     } catch (error) {
//       console.log("❌ 执行错误:", error.message);
//     }

//     console.log("");
//   });

//   console.log(`测试完成: ${passedTests}/${totalTests} 通过`);

//   if (passedTests === totalTests) {
//     console.log("🎉 所有测试通过！");
//   } else {
//     console.log(`⚠️  有 ${totalTests - passedTests} 个测试失败`);
//   }
// }

// // 运行测试（取消注释下面这行来执行测试）
// testParseFileBlocks();
