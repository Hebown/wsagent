export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
    tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, any>;
            required?: string[];
        };
    };
}

export interface LLMClient {
    chat(
        messages: Message[],
        tools?: ToolDefinition[],
        toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }
    ): Promise<Message>;
}