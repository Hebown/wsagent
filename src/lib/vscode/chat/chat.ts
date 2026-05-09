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
    // 创建 Agent 实例，绑定 LLM 和工具
    const agent = new Agent(llmClient, toolRegistry, config);

    // 创建 Chat Participant
    const participant = vscode.chat.createChatParticipant('wsagent.myagent', async (request, context, response, token) => {
        // 获取用户输入的原始文本
        const userPrompt = request.prompt;

        // 显示一个思考中的进度指示器
        response.progress('Agent 正在思考...');

        try {
            // 调用 Agent 处理用户输入
            const answer = await agent.ask(userPrompt);

            // 将最终结果以 Markdown 形式发送到聊天界面
            response.markdown(answer);
        } catch (error: any) {
            // 如果 Agent 出错，发送错误信息
            response.markdown(`[ERROR] 处理请求时出错：${error.message || String(error)}`);
        }
    });

    // 注册到扩展上下文，以便清理
    context.subscriptions.push(participant);
}