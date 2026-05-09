import * as vscode from 'vscode';
import { DeepSeekClient } from './agent/llm/deepseek-client';
import { createDefaultToolRegistry } from './agent/tools/tool-registry';
import { registerChatParticipant } from './lib/vscode/chat/chat';

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

export function activate(context: vscode.ExtensionContext) {
    // 1. 初始化 LLM 客户端（建议从环境变量或配置中读取 API Key）
	vscode.window.showInformationMessage('WSAgent 已启动！');
    const apiKey=process.env.DEEPSEEK_API_KEY as string;
    const llmClient = new DeepSeekClient(apiKey);

    // 2. 初始化工具库
    const toolRegistry = createDefaultToolRegistry();

    // 3. 注册聊天参与者（前端交互核心）
    registerChatParticipant(context, llmClient, toolRegistry);

    console.log('WSAgent 已经激活！');
}