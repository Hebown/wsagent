/*
    本文件封装各种vscode的Terminal/Shell操作
*/
import * as vscode from 'vscode';

/**
 * 获取或创建一个专用的 Agent 终端
 */
function getOrCreateTerminal(): vscode.Terminal {
    const name = 'Agent Terminal';
    const existingTerminal = vscode.window.terminals.find(t => t.name === name);
    if (existingTerminal) {
        return existingTerminal;
    }
    return vscode.window.createTerminal(name);
}

/**
 * 执行 shell 命令（非阻塞式，仅发送指令到终端）
 * 适合执行需要保持运行或手动观察结果的命令
 */
export async function executeCommand(command: string, showTerminal: boolean = true): Promise<void> {
    const terminal = getOrCreateTerminal();
    if (showTerminal) {
        terminal.show(true); // 参数 true 表示不获取焦点
    }
    terminal.sendText(command);
    console.log(`[Agent] 已发送命令: ${command}`);
}

/**
 * 在后台执行 shell 命令并获取输出结果 (阻塞式)
 * 适合大模型需要根据命令返回结果进行下一步判断的场景
 */
export async function executeCommandWithOutput(command: string, cwd?: string): Promise<{ stdout: string, stderr: string, exitCode?: number }> {
    return new Promise((resolve, reject) => {
        // 使用 vscode.ShellExecution 配合 Task 或是更简单的子进程实现
        // 考虑到插件环境，使用 node 的 child_process 是获取输出最直接的方式
        const cp = require('child_process');
        const options = {
            cwd: cwd || (vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined),
            shell: true
        };

        cp.exec(command, options, (error: any, stdout: string, stderr: string) => {
            if (error) {
                console.error(`[Agent] 执行出错: ${error.message}`);
                resolve({
                    stdout: stdout,
                    stderr: stderr || error.message,
                    exitCode: error.code
                });
            } else {
                console.log(`[Agent] 命令执行成功`);
                resolve({ stdout, stderr, exitCode: 0 });
            }
        });
    });
}

/**
 * 中止并关闭 Agent 终端
 */
export async function disposeTerminal(): Promise<void> {
    const name = 'Agent Terminal';
    const terminal = vscode.window.terminals.find(t => t.name === name);
    if (terminal) {
        terminal.dispose();
        console.log(`[Agent] 终端已关闭`);
    }
}

/**
 * 清空当前终端内容
 */
export async function clearTerminal(): Promise<void> {
    const terminal = getOrCreateTerminal();
    terminal.sendText('clear');
}