import { LLMClient, Message, ToolDefinition } from './llm/llm-client';
import { Plan } from './planner';
import { ToolRegistry } from './tools/tool-registry';
import * as fsApi from '../lib/vscode/file/file-api';

export interface AgentConfig {
    systemPrompt?: string;
    maxIterations?: number;
    temperature?: number;
    logger?: (message: string) => void; // 可自定义日志输出，默认 console.log
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

    private log(message: string): void {
        this.config.logger(`[Agent] ${message}`);
    }

    private async syncPlanToLocal(): Promise<void> {
        if (!this.currentPlan) return;
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
        if (!this.currentPlan) return;
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
                this.currentPlan = { goal: "用户请求", steps: args.steps };
                await this.syncPlanToLocal();
                this.log(`计划已更新，共 ${args.steps.length} 个步骤`);
                return `计划已更新并同步到本地。当前共有 ${args.steps.length} 个步骤。`;
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
            this.log(`--- 迭代 #${iteration} 开始 ---`);

            const response = await this.llm.chat(this.messages, this.toolRegistry.getToolDefinitions(), 'auto');
            this.messages.push(response);

            if (response.tool_calls && response.tool_calls.length > 0) {
                this.log(`LLM 请求调用 ${response.tool_calls.length} 个工具:`);
                for (const call of response.tool_calls) {
                    this.log(`  - 工具: ${call.function.name}, 参数: ${call.function.arguments}`);
                }

                for (const call of response.tool_calls) {
                    const args = JSON.parse(call.function.arguments);
                    this.log(`▶ 执行工具: ${call.function.name}, 参数: ${JSON.stringify(args)}`);
                    const startTime = Date.now();
                    const result = await this.toolRegistry.execute(call.function.name, args);
                    const duration = Date.now() - startTime;
                    this.log(`◀ 工具 ${call.function.name} 执行完毕 (${duration}ms), 结果长度: ${result.length} 字符`);
                    // 可选：输出结果的前200字符避免日志过长
                    const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;
                    this.log(`   结果预览: ${preview}`);

                    this.messages.push({
                        role: 'tool',
                        content: result,
                        tool_call_id: call.id,
                    });
                }
                continue;
            }

            const finalAnswer = response.content || '完成。';
            this.log(`最终回答: ${finalAnswer}`);
            return finalAnswer;
        }
        const timeoutMsg = `达到最大迭代次数 (${this.config.maxIterations})，停止执行。`;
        this.log(timeoutMsg);
        return timeoutMsg;
    }

    async ask(userInput: string, options?: { history?: Message[] }): Promise<string> {
    this.log(`用户输入: ${userInput}`);

    // 如果传入了历史记录，将其插入到 systemPrompt 之后，当前 userInput 之前
    if (options?.history && options.history.length > 0) {
        // 过滤掉可能重复的 system prompt，确保消息队列干净
        const validHistory = options.history.filter(m => m.role !== 'system');
        this.messages.push(...validHistory);
        this.log(`已加载 ${validHistory.length} 条历史对话上下文`);
    }

    // 放入当前用户的提问
    this.messages.push({ role: 'user', content: userInput });
    
    return this.run();
}
}