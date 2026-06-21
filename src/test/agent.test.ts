import * as assert from 'assert';
import { Agent, AgentLogEvent } from '../agent/agent';
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
        if (!next) { throw new Error('MockLLMClient 没有更多预设响应'); }
        return next;
    }
}

// 创建一个只有工具的注册表
function createMockToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();

    // create_file
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

    // create_folder
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

    // read_file
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

    // update_plan (模拟 LLM 调用 update_plan 的场景)
    registry.registerTool(
        {
            type: 'function',
            function: {
                name: 'update_plan',
                description: '更新任务计划状态',
                parameters: {
                    type: 'object',
                    properties: {
                        steps: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'number' },
                                    description: { type: 'string' },
                                    status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] }
                                }
                            }
                        }
                    },
                    required: ['steps']
                }
            }
        },
        async (args) => `计划已更新，共 ${args.steps.length} 个步骤`
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
        const agent = new Agent(mockLLM, toolRegistry,);
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
        const agent = new Agent(mockLLM, toolRegistry,);
        const answer = await agent.ask('创建文件');
        assert.strictEqual(answer, '文件已创建');
    });

    test('AgentLogEvent 枚举定义完整', () => {
        // 验证所有必要的事件类型都已定义
        assert.ok(AgentLogEvent.USER_INPUT);
        assert.ok(AgentLogEvent.PLAN_DESIGNING);
        assert.ok(AgentLogEvent.PLAN_DESIGNED);
        assert.ok(AgentLogEvent.STEP_EXECUTING);
        assert.ok(AgentLogEvent.TOOL_CALLING);
        assert.ok(AgentLogEvent.TOOL_RESULT);
        assert.ok(AgentLogEvent.CHECKING_RESULT);
        assert.ok(AgentLogEvent.STEP_COMPLETED);
        assert.ok(AgentLogEvent.STEP_FAILED);
        assert.ok(AgentLogEvent.SUMMARIZING);
        assert.ok(AgentLogEvent.FINAL_ANSWER);
        assert.ok(AgentLogEvent.ITERATION_START);
        assert.ok(AgentLogEvent.INFO);
    });

    test('日志事件在工具调用时正确触发', async () => {
        const loggedEvents: string[] = [];
        const testLogger = (msg: string) => {
            loggedEvents.push(msg);
        };

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
                content: '完成',
                tool_calls: undefined
            }
        ]);

        const agent = new Agent(mockLLM, toolRegistry, {
            logger: testLogger
        });
        await agent.ask('创建文件');

        // 验证关键事件被触发
        const allLogs = loggedEvents.join(' ');
        assert.ok(allLogs.includes(AgentLogEvent.USER_INPUT), '应包含 USER_INPUT 事件');
        assert.ok(allLogs.includes(AgentLogEvent.TOOL_CALLING), '应包含 TOOL_CALLING 事件');
        assert.ok(allLogs.includes(AgentLogEvent.TOOL_RESULT), '应包含 TOOL_RESULT 事件');
        assert.ok(allLogs.includes(AgentLogEvent.CHECKING_RESULT), '应包含 CHECKING_RESULT 事件');
        assert.ok(allLogs.includes(AgentLogEvent.SUMMARIZING), '应包含 SUMMARIZING 事件');
        assert.ok(allLogs.includes(AgentLogEvent.FINAL_ANSWER), '应包含 FINAL_ANSWER 事件');
    });
});
