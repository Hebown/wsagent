import * as vscode from 'vscode';
import { Agent, AgentLogEvent } from '../../../agent/agent';
import { LLMClient } from '../../../agent/llm/llm-client';
import { ToolRegistry } from '../../../agent/tools/tool-registry';
import { AgentConfig } from '../../../agent/agent';

/**
 * 将 Agent 的结构化日志事件映射为用户友好的聊天显示信息。
 *
 * 使用的 VS Code Chat API：
 * - response.progress(msg): 在聊天侧边栏显示一个进度指示器（带 spinner 动画），
 *   适合展示"正在执行中"的瞬时状态。
 * - response.markdown(md): 在聊天窗口中追加一段 Markdown 内容，
 *   适合展示最终结果或阶段性结论。
 *
 * 设计思路：
 * 1. Agent 内部通过 logEvent() 发出带前缀（如 [PLAN_DESIGNING]）的结构化日志。
 * 2. 此函数解析前缀，将不同阶段映射到不同的 UI 表现：
 *    - 瞬时操作（设计计划、执行步骤、调用工具、检查结果）→ progress()
 *    - 阶段性结论（计划设计完毕、步骤完成/失败、最终回答）→ markdown()
 * 3. 这样用户就能实时看到 Agent 的思考与执行过程，提升透明度和信任感。
 *
 * 友好输出设计：
 * - TOOL_CALLING 展示的是"目的"而非"工具名"，例如"正在创建文件 src/main.ts"
 *   而不是"正在执行工具「create_file」"
 * - TOOL_RESULT 展示的是结果摘要，例如"文件 "src/main.ts" 已成功写入。"
 *   而不是"工具「create_file」执行成功 (120ms)"
 * - update_plan 工具的返回信息会根据实际状态变化提供有意义的描述，
 *   例如"第 2 步已完成：创建配置文件（进度 2/5）"
 * - run_shell_command 的结果使用纯 Markdown 引用块 + 代码块展示完整输出，
 */
function formatAgentLogToChat(
    message: string,
    response: vscode.ChatResponseStream
): void {
    // 解析事件前缀
    const eventPrefix = Object.values(AgentLogEvent).find(prefix =>
        message.startsWith(prefix)
    );

    if (!eventPrefix) {
        // 无前缀的普通日志，仅输出到控制台
        console.log(`[Agent Log] ${message}`);
        return;
    }

    // 去掉前缀，获取纯消息内容
    const content = message.slice(eventPrefix.length).trim();

    switch (eventPrefix) {
        // ========== 进度指示器（瞬时状态，带 spinner） ==========

        case AgentLogEvent.PLAN_DESIGNING:
            response.progress('正在分析任务并设计执行计划...');
            break;

        case AgentLogEvent.STEP_EXECUTING:
            response.progress(content);
            break;

        case AgentLogEvent.TOOL_CALLING:
            // content 已经是友好的目的描述，如 "正在创建文件 src/main.ts"
            response.progress(content);
            break;

        case AgentLogEvent.CHECKING_RESULT:
            response.progress(content);
            break;

        case AgentLogEvent.SUMMARIZING:
            response.progress('运行完成，正在总结结果...');
            break;

        case AgentLogEvent.ITERATION_START:
            // 迭代开始信息用细粒度 progress 展示
            response.progress(content);
            break;

        // ========== Markdown 输出（阶段性结论，用户可见） ==========

        case AgentLogEvent.PLAN_DESIGNED:
            // 计划设计完毕，展示步骤列表
            response.markdown(`\n> **计划设计完毕**\n\n${content}\n`);
            break;

        case AgentLogEvent.STEP_COMPLETED:
            response.markdown(`\n> **${content}**\n`);
            break;

        case AgentLogEvent.STEP_FAILED:
            response.markdown(`\n> **${content}**\n`);
            break;

        case AgentLogEvent.TOOL_RESULT:
            // content 是纯 Markdown 文本，直接输出
            // 不再需要检测 <div> 标签或使用 supportHtml
            response.markdown(`\n> ${content}\n`);
            break;

        case AgentLogEvent.FINAL_ANSWER:
            // 最终回答已经由 agent.ask() 的返回值通过 response.markdown(answer) 展示
            // 这里不再重复输出
            break;

        case AgentLogEvent.USER_INPUT:
            // 用户输入不需要在聊天中重复
            break;

        default:
            console.log(`[Agent Log] ${message}`);
            break;
    }
}

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

        // --- 2. 创建增强的 chatLogger ---
        // 将 Agent 内部的结构化日志实时映射到聊天窗口
        const chatLogger = (message: string) => {
            formatAgentLogToChat(message, response);
        };

        const agent = new Agent(llmClient, toolRegistry, {
            ...config,
            logger: chatLogger,
        });

        try {
            // --- 3. 将 history 传入 agent ---
            const answer = await agent.ask(request.prompt, { history });

            // --- 4. 最终回答以 Markdown 形式展示 ---
            if (answer && answer !== '完成。') {
                response.markdown(answer);
            } else {
                response.markdown('任务已完成！');
            }
        } catch (error: any) {
            response.markdown(`**错误**：${error.message}`);
        }
    });

    context.subscriptions.push(participant);
}
