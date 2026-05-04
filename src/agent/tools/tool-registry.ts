import { ToolDefinition } from '../llm/llm-client';
import * as fsApi from '../../lib/editor/file/file-api';
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

    return registry;
}