import { LLMClient, Message, ToolDefinition } from './llm/llm-client';
import { Plan } from './planner';
import { ToolRegistry } from './tools/tool-registry';
import * as fsApi from '../lib/vscode/file/file-api';

export interface AgentConfig {
    systemPrompt?: string;
    maxIterations?: number;
    temperature?: number;
    logger?: (message: string) => void;
}

/**
 * Agent 日志事件类型枚举
 */
export enum AgentLogEvent {
    USER_INPUT = '[USER_INPUT]',
    PLAN_DESIGNING = '[PLAN_DESIGNING]',
    PLAN_DESIGNED = '[PLAN_DESIGNED]',
    STEP_EXECUTING = '[STEP_EXECUTING]',
    TOOL_CALLING = '[TOOL_CALLING]',
    TOOL_RESULT = '[TOOL_RESULT]',
    CHECKING_RESULT = '[CHECKING_RESULT]',
    STEP_COMPLETED = '[STEP_COMPLETED]',
    STEP_FAILED = '[STEP_FAILED]',
    SUMMARIZING = '[SUMMARIZING]',
    FINAL_ANSWER = '[FINAL_ANSWER]',
    ITERATION_START = '[ITERATION_START]',
    INFO = '[INFO]',
}

export class Agent {
    private llm: LLMClient;
    private messages: Message[];
    private config: Required<Omit<AgentConfig, 'logger'>> & { logger: (msg: string) => void };
    private toolRegistry: ToolRegistry;
    private currentPlan: Plan | null = null;
    private readonly PLAN_DIR = '.wsAgent/plans';
    private readonly RESULTS_DIR = '.wsAgent/results';
    private resultFileIndex = 0;

    constructor(llm: LLMClient, toolRegistry: ToolRegistry, config: AgentConfig = {}) {
        this.llm = llm;
        this.toolRegistry = toolRegistry;
        this.config = {
            systemPrompt: config.systemPrompt || this.getDefaultPrompt(),
            maxIterations: config.maxIterations ?? 100,
            temperature: config.temperature ?? 0.1,
            logger: config.logger ?? console.log,
        };
        this.registerPlanningTool();
        this.messages = [{ role: 'system', content: this.config.systemPrompt }];
    }

    private logEvent(event: AgentLogEvent, message: string): void {
        this.config.logger(`${event} ${message}`);
    }

    private log(message: string): void {
        this.logEvent(AgentLogEvent.INFO, message);
    }

    /**
     * 生成有含义的文件名：{时间戳}_{序号}_{简短描述}_{工具名}.log
     * @param toolName 工具名称
     * @param suffix 后缀（如 _args.log, .log）
     * @param description 简短描述，用于标识该工具调用的目的
     */
    private buildResultFileName(toolName: string, suffix: string, description?: string): string {
        const timestamp = Date.now();
        const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');

        let descTag = '';
        if (description) {
            // 清理描述中的特殊字符，取前 15 个字符作为文件名片段
            const cleaned = description
                .replace(/[🔧📄📖📁📂🗑️📟🧹📋✅❌]/g, '')  // 去掉 emoji
                .replace(/[`'"|\\:<>/*?]/g, '')             // 去掉文件名非法字符
                .replace(/\s+/g, '_')                       // 空格转下划线
                .replace(/_+/g, '_')                        // 合并连续下划线
                .replace(/^_|_$/g, '')                      // 去掉首尾下划线
                .slice(0, 15);                              // 截断
            if (cleaned.length > 0) {
                descTag = `_${cleaned}`;
            }
        }

        return `${timestamp}_${this.resultFileIndex}${descTag}_${safeToolName}${suffix}`;
    }

    /**
     * 将工具调用的完整参数保存到文件（供审计用），静默执行。
     */
    private async saveToolArgsToFile(toolName: string, args: Record<string, any>, description?: string): Promise<void> {
        this.resultFileIndex++;
        const fileName = this.buildResultFileName(toolName, '_args.log', description);
        const filePath = `${this.RESULTS_DIR}/${fileName}`;

        const saveContent = [
            `# Tool: ${toolName}`,
            `# Time: ${new Date().toISOString()}`,
            `# Description: ${description || '(无描述)'}`,
            `# Full Arguments:`,
            JSON.stringify(args, null, 2),
        ].join('\n');

        try {
            await fsApi.ensureFile(filePath, saveContent, true);
        } catch (err) {
            // 静默处理，不影响主流程
        }
    }

    /**
     * 将工具执行的完整结果保存到文件（供审计用），静默执行。
     */
    private async saveToolResultToFile(
        toolName: string,
        args: Record<string, any>,
        result: string,
        description?: string
    ): Promise<void> {
        this.resultFileIndex++;
        const fileName = this.buildResultFileName(toolName, '.log', description);
        const filePath = `${this.RESULTS_DIR}/${fileName}`;

        const saveContent = [
            `# Tool: ${toolName}`,
            `# Time: ${new Date().toISOString()}`,
            `# Description: ${description || '(无描述)'}`,
            `# Arguments:`,
            JSON.stringify(args, null, 2),
            `# Output:`,
            result,
        ].join('\n');

        try {
            await fsApi.ensureFile(filePath, saveContent, true);
        } catch (err) {
            // 静默处理，不影响主流程
        }
    }

    /**
     * 生成友好的工具调用描述（显示给用户，不包含完整参数）
     */
    private formatToolCall(toolName: string, args: Record<string, any>): string {
        switch (toolName) {
            case 'run_shell_command': {
                const cmd = args.command || '';
                const shortCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                return `🔧 执行命令: \`${shortCmd}\``;
            }
            case 'create_file': {
                const content = args.content || '';
                const size = content.length;
                return `📄 创建文件: \`${args.filePath}\` (${size} 字节)`;
            }
            case 'read_file':
                return `📖 读取文件: \`${args.filePath}\``;
            case 'create_folder':
                return `📁 创建文件夹: \`${args.folderPath}\``;
            case 'list_directory':
                return `📂 查看目录: \`${args.dirPath}\``;
            case 'delete_file_or_folder':
                return `🗑️ 删除: \`${args.targetPath}\``;
            case 'send_to_terminal': {
                const cmd = args.command || '';
                const shortCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                return `📟 发送到终端: \`${shortCmd}\``;
            }
            case 'clear_terminal':
                return '🧹 清空终端';
            case 'update_plan':
                return '📋 更新计划';
            default: {
                const paramPreview = Object.entries(args)
                    .slice(0, 2)
                    .map(([k, v]) => {
                        const str = String(v);
                        return `${k}=${str.length > 30 ? str.slice(0, 30) + '...' : str}`;
                    })
                    .join(', ');
                return `🔧 执行「${toolName}」(${paramPreview})`;
            }
        }
    }

    /**
     * 生成友好的工具结果摘要（显示给用户，不包含完整输出）
     */
    private formatToolResult(toolName: string, args: Record<string, any>, result: string): string {
        switch (toolName) {
            case 'run_shell_command': {
                const cmd = args.command || '';
                const shortCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                const exitCodeMatch = result.match(/退出码: (\d+)/);
                const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1]) : -1;
                const isSuccess = exitCode === 0;
                const status = isSuccess ? '✅ 成功' : `❌ 失败(退出码=${exitCode})`;
                return `执行 \`${shortCmd}\` ${status}`;
            }
            case 'read_file': {
                const filePathArg = args.filePath || '';
                return `文件 \`${filePathArg}\` 已读取成功`;
            }
            case 'list_directory': {
                const dirPath = args.dirPath || '';
                const lines = result.split('\n');
                const fileCount = lines.filter(l => l.startsWith('📄')).length;
                const dirCount = lines.filter(l => l.startsWith('📁')).length;
                return `目录 \`${dirPath}\` 包含 ${dirCount} 个文件夹, ${fileCount} 个文件`;
            }
            case 'create_file':
                return `文件 \`${args.filePath}\` 已创建`;
            case 'create_folder':
                return `文件夹 \`${args.folderPath}\` 已创建`;
            case 'delete_file_or_folder':
                return `已删除 \`${args.targetPath}\``;
            case 'send_to_terminal':
                return `命令已发送到终端: \`${(args.command || '').slice(0, 60)}\``;
            case 'clear_terminal':
                return '终端已清空';
            case 'update_plan':
                return result;
            default:
                const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
                return preview;
        }
    }

    private async syncPlanToLocal(): Promise<void> {
        if (!this.currentPlan) {
            return;
        }
        const filePath = `${this.PLAN_DIR}/current_plan.json`;
        const content = JSON.stringify(this.currentPlan, null, 4);
        try {
            await fsApi.ensureFile(filePath, content, true);
            this.log(`计划已同步至本地: ${filePath}`);
        } catch (err) {
            this.log(`同步计划失败: ${err}`);
        }
    }

    public async loadPlanFromLocal(): Promise<boolean> {
        const filePath = `${this.PLAN_DIR}/current_plan.json`;
        try {
            const exists = await fsApi.exists(filePath);
            if (exists) {
                const content = await fsApi.readFile(filePath);
                this.currentPlan = JSON.parse(content);
                this.log(`从本地加载计划成功，已完成步骤: ${this.currentPlan?.steps.filter(s => s.status === 'completed').length}`);
                this.injectPlanContext();
                return true;
            }
        } catch (err) {
            this.log(`加载本地计划失败: ${err}`);
        }
        return false;
    }

    private injectPlanContext() {
        if (!this.currentPlan) {
            return;
        }
        const completedSteps = this.currentPlan.steps.filter(s => s.status === 'completed');
        const pendingSteps = this.currentPlan.steps.filter(s => s.status === 'pending');
        const contextPrompt = `
[断点恢复] 检测到本地已存在执行中的计划：
- 已完成步骤: ${completedSteps.map(s => s.description).join(', ')}
- 待执行步骤: ${pendingSteps.map(s => s.description).join(', ')}
请根据当前状态继续执行，不要重复已完成的操作。`;
        this.messages.push({ role: 'system', content: contextPrompt });
        this.log(`已注入计划恢复上下文（已完成${completedSteps.length}步）`);
    }

    private registerPlanningTool() {
        this.toolRegistry.registerTool(
            {
                type: 'function',
                function: {
                    name: 'update_plan',
                    description: '更新任务计划状态。每当一个步骤开始或完成时，都必须调用此工具同步进度。',
                    parameters: {
                        type: 'object',
                        properties: {
                            steps: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        id: { type: 'number' },
                                        description: { type: 'string' },
                                        status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] }
                                    }
                                }
                            }
                        },
                        required: ['steps']
                    }
                }
            },
            async (args) => {
                const isNewPlan = !this.currentPlan;
                const steps = args.steps as Array<{ id: number; description: string; status: string }>;

                if (isNewPlan) {
                    this.logEvent(AgentLogEvent.PLAN_DESIGNING, '正在分析任务并设计执行计划...');
                }

                const oldSteps = this.currentPlan?.steps || [];
                this.currentPlan = { goal: "用户请求", steps: args.steps };
                await this.syncPlanToLocal();

                const runningStep = steps.find(s => s.status === 'running');
                const completedStep = steps.find(s => s.status === 'completed');
                const failedStep = steps.find(s => s.status === 'failed');

                let returnMessage: string;

                if (isNewPlan) {
                    const stepDescriptions = steps.map(s => `  ${s.id}. ${s.description}`).join('\n');
                    this.logEvent(AgentLogEvent.PLAN_DESIGNED,
                        `计划设计完毕，共 ${steps.length} 个步骤：\n${stepDescriptions}`
                    );
                    returnMessage = `计划已创建，共 ${steps.length} 个步骤`;
                } else if (runningStep) {
                    this.logEvent(AgentLogEvent.STEP_EXECUTING,
                        `正在执行计划中的第 ${runningStep.id} 步：${runningStep.description}`
                    );
                    returnMessage = `开始执行第 ${runningStep.id} 步：${runningStep.description}`;
                } else if (completedStep) {
                    this.logEvent(AgentLogEvent.STEP_COMPLETED,
                        `第 ${completedStep.id} 步已完成：${completedStep.description}`
                    );
                    const completedCount = steps.filter(s => s.status === 'completed').length;
                    const totalCount = steps.length;
                    returnMessage = `第 ${completedStep.id} 步已完成：${completedStep.description}（进度 ${completedCount}/${totalCount}）`;
                } else if (failedStep) {
                    this.logEvent(AgentLogEvent.STEP_FAILED,
                        `第 ${failedStep.id} 步失败：${failedStep.description}`
                    );
                    returnMessage = `第 ${failedStep.id} 步失败：${failedStep.description}`;
                } else {
                    const newStepIds = steps.map(s => s.id);
                    const oldStepIds = oldSteps.map(s => s.id);
                    const addedSteps = steps.filter(s => !oldStepIds.includes(s.id));
                    const removedSteps = oldSteps.filter(s => !newStepIds.includes(s.id));

                    const changes: string[] = [];
                    if (addedSteps.length > 0) {
                        changes.push(`新增 ${addedSteps.length} 个步骤`);
                    }
                    if (removedSteps.length > 0) {
                        changes.push(`移除 ${removedSteps.length} 个步骤`);
                    }
                    const changeDesc = changes.length > 0 ? `（${changes.join('，')}）` : '（状态无变化）';
                    returnMessage = `计划已更新，共 ${steps.length} 个步骤 ${changeDesc}`;
                }

                return returnMessage;
            }
        );
    }

    private getDefaultPrompt(): string {
        return `你是一个拥有计划能力的 AI Agent。
当用户提出任务时：
1. 使用 'update_plan' 工具分解任务。
2. 逐步执行工具，并在每一步完成后更新计划状态。
3. 如果遇到报错，修改计划增加修复步骤。
在执行 Shell 命令时，你应当首先检查终端类型，以使用符合终端类型的 Shell 命令；
在执行多条 Shell 命令时，请遵循以下严格准则：
1. **禁止使用反斜杠 (\\) 换行**。请将多条命令写在同一行，并使用 '&&' 或 ';' 分隔。
2. **禁止执行无限循环任务**。例如 'ping' 必须带上 '-c 4' 参数。
3. **后台任务**：如果需要启动监听（如 sniff），请使用封装的 'send_to_terminal'，不要在 'run_shell_command' 中阻塞。
示例：'cd Labsetup && docker exec hostA ping -c 2 1.2.3.4 && sleep 2'
务必将执行命令得到的中间结果都保存在特定的文件中，并在最终迁移到用户的主机上，以证明实验数据可靠完整。
`;
    }

    async run(): Promise<string> {
        let iteration = 0;
        while (iteration < this.config.maxIterations) {
            iteration++;
            this.logEvent(AgentLogEvent.ITERATION_START, `--- 迭代 #${iteration} 开始 ---`);

            const response = await this.llm.chat(this.messages, this.toolRegistry.getToolDefinitions(), 'auto');
            this.messages.push(response);

            if (response.tool_calls && response.tool_calls.length > 0) {
                this.log(`LLM 请求调用 ${response.tool_calls.length} 个工具:`);
                for (const call of response.tool_calls) {
                    this.log(`  - 工具: ${call.function.name}`);
                }

                for (const call of response.tool_calls) {
                    const args = JSON.parse(call.function.arguments);

                    // 1. 生成精简版调用日志（同时作为文件名的描述来源）
                    const toolCallLog = this.formatToolCall(call.function.name, args);
                    this.logEvent(AgentLogEvent.TOOL_CALLING, toolCallLog);

                    // 2. 保存完整参数到文件（静默），使用 formatToolCall 的返回值作为描述
                    await this.saveToolArgsToFile(call.function.name, args, toolCallLog);

                    // 3. 执行工具
                    const startTime = Date.now();
                    const result = await this.toolRegistry.execute(call.function.name, args);
                    const duration = Date.now() - startTime;

                    // 4. 保存完整结果到文件（静默），使用 formatToolCall 的返回值作为描述
                    await this.saveToolResultToFile(call.function.name, args, result, toolCallLog);

                    // 5. 显示精简版结果摘要给用户
                    const friendlyResult = this.formatToolResult(call.function.name, args, result);
                    this.logEvent(AgentLogEvent.TOOL_RESULT, friendlyResult);

                    // 6. 传给 LLM 的仍然是完整结果
                    this.messages.push({
                        role: 'tool',
                        content: result,
                        tool_call_id: call.id,
                    });
                }
                continue;
            }

            const finalAnswer = response.content || '完成。';
            this.logEvent(AgentLogEvent.SUMMARIZING, '运行完成，正在总结结果...');
            this.logEvent(AgentLogEvent.FINAL_ANSWER, finalAnswer);
            return finalAnswer;
        }
        const timeoutMsg = `达到最大迭代次数 (${this.config.maxIterations})，停止执行。`;
        this.log(timeoutMsg);
        return timeoutMsg;
    }

    async ask(userInput: string, options?: { history?: Message[] }): Promise<string> {
        this.logEvent(AgentLogEvent.USER_INPUT, userInput);

        if (options?.history && options.history.length > 0) {
            const validHistory = options.history.filter(m => m.role !== 'system');
            this.messages.push(...validHistory);
            this.log(`已加载 ${validHistory.length} 条历史对话上下文`);
        }

        this.messages.push({ role: 'user', content: userInput });
        return this.run();
    }
}
