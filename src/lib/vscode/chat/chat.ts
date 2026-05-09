import * as vscode from 'vscode';
import { Agent } from '../../../agent/agent';
import { LLMClient } from '../../../agent/llm/llm-client';
import { ToolRegistry } from '../../../agent/tools/tool-registry';
import { AgentConfig } from '../../../agent/agent';

// chat.ts
export function registerChatParticipant(
    context: vscode.ExtensionContext,
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    config?: AgentConfig
): void {
    const participant = vscode.chat.createChatParticipant('wsagent.myagent', async (request, context, response, token) => {
        const userPrompt = request.prompt;

        // 1. 创建一个能够将日志发送到 Chat 窗口的 logger
        const chatLogger = (message: string) => {
            // 1. 瞬态信息：使用 progress。它会显示在聊天窗口顶部，随操作结束而消失。
            if (message.startsWith('▶ 执行工具')) {
                response.progress(message.replace('▶ ', '🛠️ ')); 
            } 
            // 2. 关键里程碑：使用 markdown 持久化到对话中，但要控制频率和格式
            else if (message.includes('计划已更新') || message.includes('断点恢复')) {
                response.markdown(`\n> **Progress**: ${message}\n`);
            } 
            // 3. 其他详细调试信息只打在控制台，不干扰 UI
            else {
                console.log(`[Agent Log] ${message}`);
            }
        };

        // 2. 每次请求动态创建一个关联当前 response 的 Agent 实例
        // 或者修改 Agent 类允许动态更新 logger
        const agent = new Agent(llmClient, toolRegistry, {
            ...config,
            logger: chatLogger
        });

        try {
            const answer = await agent.ask(userPrompt);
            response.markdown(answer);
        } catch (error: any) {
            response.markdown(`[ERROR] 处理请求时出错：${error.message || String(error)}`);
        }
    });

    context.subscriptions.push(participant);
}