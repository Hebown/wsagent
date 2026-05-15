import * as vscode from 'vscode';
import { Agent } from '../../../agent/agent';
import { LLMClient } from '../../../agent/llm/llm-client';
import { ToolRegistry } from '../../../agent/tools/tool-registry';
import { AgentConfig } from '../../../agent/agent';

export function registerChatParticipant(
    context: vscode.ExtensionContext,
    llmClient: LLMClient,
    toolRegistry: ToolRegistry,
    config?: AgentConfig
): void {
    const participant = vscode.chat.createChatParticipant('wsagent.myagent', async (request, chatContext, response, token) => {
        
        // --- 1. 提取并转换历史记录 ---
        const history: any[] = chatContext.history.map(turn => {
            if (turn instanceof vscode.ChatRequestTurn) {
                return { role: 'user', content: turn.prompt };
            } else if (turn instanceof vscode.ChatResponseTurn) {
                // 将响应中的多个部分（Markdown, FileTree等）合并为文本字符串
                const fullResponse = turn.response
                    .map(r => (r instanceof vscode.ChatResponseMarkdownPart ? r.value.value : ''))
                    .join('\n');
                return { role: 'assistant', content: fullResponse };
            }
            return null;
        }).filter(msg => msg !== null);

        const chatLogger = (message: string) => {
            if (message.startsWith('▶ 执行工具')) {
                response.progress(message.replace('▶ ', '🛠️ ')); 
            } else if (message.includes('计划已更新')) {
                response.markdown(`\n> **Progress**: ${message}\n`);
            } else {
                console.log(`[Agent Log] ${message}`);
            }
        };

        const agent = new Agent(llmClient, toolRegistry, {
            ...config,
            logger: chatLogger
        });

        try {
            // --- 2. 将 history 传入 agent ---
            const answer = await agent.ask(request.prompt, { history }); 
            response.markdown(answer);
        } catch (error: any) {
            response.markdown(`[ERROR] 出错：${error.message}`);
        }
    });

    context.subscriptions.push(participant);
}

