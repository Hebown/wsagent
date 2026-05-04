import { LLMClient, Message, ToolDefinition } from './llm/llm-client';
import { ToolRegistry } from './tools/tool-registry';

export interface AgentConfig {
    systemPrompt?: string;
    maxIterations?: number;
    temperature?: number;
}

export class Agent { // 所谓 agent是一个封装了 llmclient的类，面向用户使用。用户用ask向agent问问题，agent用run和llm chat，并替llm执行tool_call或者是返回结果。
    private llm: LLMClient;
    private messages: Message[];
    private config: Required<AgentConfig>;
    private toolRegistry: ToolRegistry;

    constructor(llm: LLMClient, toolRegistry: ToolRegistry, config: AgentConfig = {}) {
        this.llm = llm;
        this.toolRegistry = toolRegistry;
        this.config = {
            systemPrompt: config.systemPrompt || '你是一个智能助手...',
            maxIterations: config.maxIterations ?? 10,
            temperature: config.temperature ?? 0.1,
        };
        this.messages = [{ role: 'system', content: this.config.systemPrompt }];
    }

    async run(): Promise<string> {
        let iteration = 0;
        while (iteration < this.config.maxIterations) {
            iteration++;
            const response = await this.llm.chat(this.messages, this.toolRegistry.getToolDefinitions(), 'auto');
            this.messages.push(response);

            if (response.tool_calls && response.tool_calls.length > 0) {
                for (const call of response.tool_calls) {
                    const args = JSON.parse(call.function.arguments);
                    const result = await this.toolRegistry.execute(call.function.name, args);
                    this.messages.push({
                        role: 'tool',
                        content: result,
                        tool_call_id: call.id,
                    });
                }
                continue;
            }
            return response.content || '完成。';
        }
        return '达到最大迭代次数。';
    }

    async ask(userInput: string): Promise<string> {
        this.messages.push({ role: 'user', content: userInput });
        return this.run();
    }
}