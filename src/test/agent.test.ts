import * as assert from 'assert';
import { Agent } from '../agent/agent';
import { LLMClient, Message, ToolDefinition } from '../agent/llm/llm-client';
import { ToolRegistry } from '../agent/tools/tool-registry';

class MockLLMClient implements LLMClient {
    private responses: Message[];

    constructor(responses: Message[]) {
        this.responses = [...responses];
    }

    async chat(
        messages: Message[],
        tools?: ToolDefinition[],
        toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
    ): Promise<Message> {
        const next = this.responses.shift();
        if (!next){ throw new Error('MockLLMClient 没有更多预设响应');}
        return next;
    }
}

// 创建一个只有工具的注册表
function createMockToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    //  create_file
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'create_file',
                description: '创建文件',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' },
                        content: { type: 'string' }
                    },
                    required: ['filePath', 'content']
                }
            }
        },
        async (args) => `已创建文件 ${args.filePath}`
    );

    //  create_folder
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'create_folder',
                description: '创建文件夹',
                parameters: {
                    type: 'object',
                    properties: {
                        folderPath: { type: 'string' }
                    },
                    required: ['folderPath']
                }
            }
        },
        async (args) => `已创建文件夹 ${args.folderPath}`
    );

    //  read_file
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'read_file',
                description: '读取文件',
                parameters: {
                    type: 'object',
                    properties: {
                        filePath: { type: 'string' }
                    },
                    required: ['filePath']
                }
            }
        },
        async (args) => `读取文件 ${args.filePath} 的内容：模拟内容`
    );

    return registry;
}

suite('Agent 核心逻辑', () => {
    let toolRegistry: ToolRegistry;

    setup(() => {
        toolRegistry = createMockToolRegistry();
    });

    test('无工具调用，直接返回答案', async () => {
        const mockLLM = new MockLLMClient([
            { role: 'assistant', content: 'Hello from Agent', tool_calls: undefined }
        ]);
        const agent = new Agent(mockLLM, toolRegistry, { maxIterations: 3 });
        const answer = await agent.ask('你好');
        assert.strictEqual(answer, 'Hello from Agent');
    });

    test('单次工具调用后给出最终答案', async () => {
        const mockLLM = new MockLLMClient([
            {
                role: 'assistant',
                content: '',
                tool_calls: [{
                    id: 'call_1',
                    type: 'function',
                    function: {
                        name: 'create_file',
                        arguments: JSON.stringify({ filePath: 'test.txt', content: 'hello' })
                    }
                }]
            },
            {
                role: 'assistant',
                content: '文件已创建',
                tool_calls: undefined
            }
        ]);
        const agent = new Agent(mockLLM, toolRegistry, { maxIterations: 5 });
        const answer = await agent.ask('创建文件');
        assert.strictEqual(answer, '文件已创建');
    });

    test('达到最大迭代次数强制停止', async () => {
        const infiniteToolCall: Message = {
            role: 'assistant',
            content: '',
            tool_calls: [{
                id: 'loop',
                type: 'function',
                function: {
                    name: 'create_file',
                    arguments: JSON.stringify({ filePath: 'loop.txt', content: '' })
                }
            }]
        };
        const manyResponses = Array(10).fill(infiniteToolCall);
        const mockLLM = new MockLLMClient(manyResponses);
        const agent = new Agent(mockLLM, toolRegistry, { maxIterations: 2 });
        const answer = await agent.ask('循环创建文件');
        assert.ok(answer.includes('最大迭代次数'));
    });
});