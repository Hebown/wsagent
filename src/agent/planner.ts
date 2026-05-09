export interface PlanStep {
    id: number;
    description: string;   // 步骤描述，例如 "编译项目并检查 LNK2019 错误"
    status: 'pending' | 'running' | 'completed' | 'failed';
    result?: string;       // 存储工具执行的输出，如 shell 的 stdout
}

export interface Plan {
    goal: string;
    steps: PlanStep[];
}