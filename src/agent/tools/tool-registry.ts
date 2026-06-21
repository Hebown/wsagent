import { ToolDefinition } from '../llm/llm-client';
import * as fsApi from '../../lib/vscode/file/file-api';
import * as shellApi from '../../lib/vscode/terminal/terminal';
type ToolExecutor = (args: any) => Promise<string>;

export class ToolRegistry {
    private tools: Map<string, { definition: ToolDefinition; executor: ToolExecutor }> = new Map();

    registerTool(definition: ToolDefinition, executor: ToolExecutor): void {
        this.tools.set(definition.function.name, { definition, executor });
    }

    getToolDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map(t => t.definition);
    }

    async execute(toolName: string, args: any): Promise<string> {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return `错误：未找到工具 ${toolName}`;
        }
        try {
            return await tool.executor(args);
        } catch (err: any) {
            return `执行 ${toolName} 失败：${err.message || String(err)}`;
        }
    }
}

export function createDefaultToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    // 1. 创建文件
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'create_file',
                description: '创建或覆盖一个文件，并写入内容。如果父目录不存在会自动创建。',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: '相对于工作区根目录的路径，例如 "src/main.py"' },
                        content: { type: 'string', description: '文件内容' },
                        overwrite: { type: 'boolean', description: '是否覆盖已存在的文件，默认 true' }
                    },
                    required: ['filePath', 'content']
                }
            }
        },
        async (args) => {
            await fsApi.ensureFile(args.filePath, args.content, args.overwrite ?? true);
            return `文件 "${args.filePath}" 已成功写入。`;
        }
    );

    // 2. 读取文件
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'read_file',
                description: '读取指定文件的全部内容。',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: '相对于工作区根目录的路径' }
                    },
                    required: ['filePath']
                }
            }
        },
        async (args) => {
            const content = await fsApi.readFile(args.filePath);
            return `文件 "${args.filePath}" 的内容如下：\n${content}`;
        }
    );

    // 3. 创建文件夹
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'create_folder',
                description: '创建一个文件夹（可以递归创建父目录）。',
                parameters: {
                    type: 'object',
                    properties: {
                        folderPath: { type: 'string', description: '相对于工作区根目录的路径' },
                        recursive: { type: 'boolean', description: '是否创建父目录，默认 true' }
                    },
                    required: ['folderPath']
                }
            }
        },
        async (args) => {
            await fsApi.createFolder(args.folderPath, args.recursive ?? true);
            return `文件夹 "${args.folderPath}" 已创建。`;
        }
    );

    // 4. 列出目录内容
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'list_directory',
                description: '列出目录下的所有文件和子文件夹。',
                parameters: {
                    type: 'object',
                    properties: {
                        dirPath: { type: 'string', description: '相对于工作区根目录的路径' }
                    },
                    required: ['dirPath']
                }
            }
        },
        async (args) => {
            const entries = await fsApi.listDirectory(args.dirPath);
            const lines = entries.map(e => `${e.isDirectory ? '📁' : '📄'} ${e.name}`);
            return `目录 "${args.dirPath}" 的内容：\n${lines.join('\n') || '(空目录)'}`;
        }
    );

    // 5. 删除文件或文件夹
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'delete_file_or_folder',
                description: '删除文件或文件夹（谨慎使用）。',
                parameters: {
                    type: 'object',
                    properties: {
                        targetPath: { type: 'string', description: '相对路径' },
                        recursive: { type: 'boolean', description: '删除文件夹时必须设为 true' }
                    },
                    required: ['targetPath']
                }
            }
        },
        async (args) => {
            await fsApi.deleteFileOrFolder(args.targetPath, args.recursive ?? false);
            return `已删除 "${args.targetPath}"。`;
        }
    );

    // 6. 执行命令并获取输出 (阻塞式)
    // 适用于需要 LLM 根据运行结果（如编译错误或单元测试结果）进行分析的场景
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'run_shell_command',
                description: '在终端执行命令并等待返回 stdout 和 stderr。适用于运行脚本、编译代码或检查系统状态。',
                parameters: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: '要执行的完整 shell 命令' },
                        cwd: { type: 'string', description: '执行命令的工作目录，默认为工作区根目录' }
                    },
                    required: ['command']
                }
            }
        },
        async (args) => {
            const result = await shellApi.executeCommandWithOutput(args.command, args.cwd);
            let output = `命令 [${args.command}] 执行完毕 (退出码: ${result.exitCode})\n`;
            if (result.stdout) output += `--- 标准输出 ---\n${result.stdout}\n`;
            if (result.stderr) output += `--- 错误输出 ---\n${result.stderr}\n`;
            return output;
        }
    );

    // 7. 发送命令到交互式终端 (非阻塞)
    // 适用于启动服务器、打开 GUI 程序或需要用户持续观察输出的场景
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'send_to_terminal',
                description: '将命令发送到名为 "Agent Terminal" 的 VS Code 终端窗口。命令会立即运行，但不会捕获其返回文本。',
                parameters: {
                    type: 'object',
                    properties: {
                        command: { type: 'string', description: '要发送的命令内容' },
                        showTerminal: { type: 'boolean', description: '是否自动弹出终端面板，默认 true' }
                    },
                    required: ['command']
                }
            }
        },
        async (args) => {
            await shellApi.executeCommand(args.command, args.showTerminal ?? true);
            return `命令 "${args.command}" 已发送到交互式终端。`;
        }
    );

    // 8. 清空或重置终端
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'clear_terminal',
                description: '清空 Agent 专用终端的显示内容。',
                parameters: { type: 'object', properties: {} }
            }
        },
        async () => {
            await shellApi.clearTerminal();
            return "终端已清空。";
        }
    );

    // 9. 替换文件中的文本
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'replace_in_file',
                description: '替换文件中指定的文本内容（纯文本替换，非正则）。支持替换所有出现或指定第几次出现。',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: '相对于工作区根目录的文件路径，例如 "src/main.py"' },
                        searchText: { type: 'string', description: '要搜索并替换的文本（纯文本，非正则表达式）' },
                        replaceText: { type: 'string', description: '替换后的新文本' },
                        occurrence: { type: 'number', description: '指定替换第几次出现（0=替换所有，1=替换第1次，2=替换第2次...），默认 0' }
                    },
                    required: ['filePath', 'searchText', 'replaceText']
                }
            }
        },
        async (args) => {
            const result = await fsApi.replaceInFile(
                args.filePath,
                args.searchText,
                args.replaceText,
                args.occurrence ?? 0
            );
            return result;
        }
    );

    // 10. 追加内容到文件末尾（解决输出截断问题的核心工具）
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'append_to_file',
                description: '向文件末尾追加内容（如果文件不存在则创建）。这是解决模型输出被截断问题的核心工具——当一次 create_file 无法写完整个文件时，可以分多次调用 append_to_file 来续写完整内容。',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: '相对于工作区根目录的文件路径，例如 "src/main.py"' },
                        content: { type: 'string', description: '要追加到文件末尾的内容' },
                        ensureNewline: { type: 'boolean', description: '是否在追加前确保文件末尾有换行（默认 true）' }
                    },
                    required: ['filePath', 'content']
                }
            }
        },
        async (args) => {
            const result = await fsApi.appendToFile(
                args.filePath,
                args.content,
                args.ensureNewline ?? true
            );
            return result;
        }
    );

    // 11. 获取文件信息（检查文件完整性）
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'get_file_info',
                description: '获取文件的大小、字符数、行数等信息。用于检查文件是否完整写入，辅助分块续写策略。',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string', description: '相对于工作区根目录的文件路径' }
                    },
                    required: ['filePath']
                }
            }
        },
        async (args) => {
            const result = await fsApi.getFileInfo(args.filePath);
            return result;
        }
    );

    // 12. think — 让 AI 在工具调用之间输出过渡性文字
    // 这个工具不执行任何实际操作，只是让 AI 能够主动向用户解释：
    // - 刚才执行了什么工具、结果如何
    // - 对中间结果的分析和思考
    // - 下一步计划做什么
    // - 遇到的困难和解决方案
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'think',
                description: '【过渡上下文工具】在工具调用之间输出描述性文字，向用户解释你刚才做了什么、结果如何、下一步计划等。这个工具不执行任何实际操作，只是让你能够在多个工具调用之间穿插分析、思考和解释。当你需要向用户展示你的思考过程、分析中间结果、或解释下一步计划时，请调用此工具。',
                parameters: {
                    type: 'object',
                    properties: {
                        thought: {
                            type: 'string',
                            description: '你要向用户展示的思考内容。可以包含：对刚才执行结果的总结、对中间数据的分析、遇到的问题及解决方案、下一步的执行计划等。'
                        }
                    },
                    required: ['thought']
                }
            }
        },
        async (args) => {
            const thought = args.thought || '';
            return `[THOUGHT] ${thought}`;
        }
    );

    return registry;
}
