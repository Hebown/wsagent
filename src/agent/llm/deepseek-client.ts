import OpenAI from 'openai';
import { LLMClient, Message, ToolDefinition } from './llm-client/llm-client';

export class DeepSeekClient implements LLMClient {
    private client: OpenAI;
    private model: string = 'deepseek-chat';

    constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
        this.client = new OpenAI({ apiKey, baseURL });
    }

    async chat(
        messages: Message[],
        tools?: ToolDefinition[],
        toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
    ): Promise<Message> {
        const response = await this.client.chat.completions.create({
            model: this.model,
            messages: messages as any,
            tools: tools,
            tool_choice: toolChoice,
            temperature: 0.1,
        });
        const choice = response.choices[0];
        const message = choice.message;
        return {
            role: 'assistant',
            content: message.content || '',
            tool_calls: message.tool_calls?.map((tc: any) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
        };
    }
}