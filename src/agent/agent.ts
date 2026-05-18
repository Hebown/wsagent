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
     * 生成友好的工具目的描述
     */
    private formatToolPurpose(toolName: string, args: Record<string, any>): string {
        switch (toolName) {
            case 'create_file':
                return `正在创建文件 \`${args.filePath}\``;
            case 'read_file':
                return `正在读取文件 \`${args.filePath}\``;
            case 'create_folder':
                return `正在创建文件夹 \`${args.folderPath}\``;
            case 'list_directory':
                return `正在查看目录 \`${args.dirPath}\` 的内容`;
            case 'delete_file_or_folder':
                return `正在删除 \`${args.targetPath}\``;
            case 'run_shell_command': {
                const cmd = args.command || '';
                const shortCmd = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
                return `正在执行脚本：\`${shortCmd}\``;
            }
            case 'send_to_terminal': {
                const cmd = args.command || '';
                const shortCmd = cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
                return `正在启动服务：\`${shortCmd}\``;
            }
            case 'clear_terminal':
                return '正在清空终端';
            case 'update_plan':
                return '正在更新任务计划';
            default:
                const paramPreview = Object.entries(args)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}=${String(v).slice(0, 30)}`)
                    .join(', ');
                return `正在执行「${toolName}」(${paramPreview})`;
        }
    }

    /**
     * 生成友好的结果描述。
     * 对于 run_shell_command，生成一句话摘要 + 纯 Markdown 引用块包装完整输出。
     * 不使用任何 HTML 标签，确保 Chat 侧边栏兼容渲染。
     */
    private formatToolResult(toolName: string, args: Record<string, any>, result: string): string {
        switch (toolName) {
            case 'run_shell_command': {
                const cmd = args.command || '';

                // 提取退出码
                const exitCodeMatch = result.match(/退出码: (\d+)/);
                const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1]) : -1;
                const isSuccess = exitCode === 0;

                // 一句话摘要
                const shortCmd = cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
                const summary = isSuccess
                    ? `运行并测试项目二进制文件：\`${shortCmd}\``
                    : `运行并测试项目二进制文件：\`${shortCmd}\`（退出码 ${exitCode}）`;

                // 转义结果中的反引号，防止破坏 Markdown 代码块
                const escapedResult = result.replace(/`/g, '\\`');

                // 使用纯 Markdown 引用块 + 代码块展示完整输出
                // 不依赖任何 HTML 标签，Chat 侧边栏 100% 兼容
                return `${summary}\n\n> **完整输出：**\n>\n> \`\`\`\n> ${escapedResult.replace(/\n/g, '\n> ')}\n> \`\`\``;
            }
            case 'read_file': {
                // 只告知文件已读取成功，不输出文件内容
                const filePath = args.filePath || '';
                return `文件 \`${filePath}\` 已读取成功`;
            }
            default:
                return result;
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

                    const purpose = this.formatToolPurpose(call.function.name, args);
                    this.logEvent(AgentLogEvent.TOOL_CALLING, purpose);

                    const startTime = Date.now();
                    const result = await this.toolRegistry.execute(call.function.name, args);
                    const duration = Date.now() - startTime;

                    const friendlyResult = this.formatToolResult(call.function.name, args, result);
                    this.logEvent(AgentLogEvent.TOOL_RESULT, friendlyResult);

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
