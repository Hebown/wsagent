import * as vscode from 'vscode';
import { DeepSeekClient } from './agent/llm/deepseek-client';
import { createDefaultToolRegistry } from './agent/tools/tool-registry';
import { registerChatParticipant } from './lib/vscode/chat/chat';

import * as dotenv from 'dotenv';
import * as path from 'path';
import { getWorkspaceRoot } from './lib/vscode/file/file-api';

const workspaceDirPath=getWorkspaceRoot().fsPath;
dotenv.config({ path: path.join(workspaceDirPath, '.env') });

export function activate(context: vscode.ExtensionContext) {
    // 1. 初始化 LLM 客户端
	vscode.window.showInformationMessage('WSAgent 已启动！');
    
	vscode.window.showInformationMessage("尝试在 "+path.join(workspaceDirPath,'.env')+" 下加载 env");
    const apiKey=process.env.DEEPSEEK_API_KEY as string;
    if(!apiKey){
        vscode.window.showErrorMessage("未能成功加载 env 中的apiKey，请检查后重试");
        return;
    }

    const model = process.env.LLM_MODEL as string | undefined;
    const llmClient = new DeepSeekClient(apiKey, 'https://api.deepseek.com', model);

    // 2. 初始化工具库
    const toolRegistry = createDefaultToolRegistry();

    // 3. 注册聊天参与者
    registerChatParticipant(context, llmClient, toolRegistry);

    console.log('WSAgent 已经激活！');
}
