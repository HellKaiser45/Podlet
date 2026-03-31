import { PendingApproval } from "../types";
import { ChatCompletionMessageToolCall } from "openai/resources/index";


export class HilManager {
  private safemode: boolean;

  constructor(safe: boolean) {
    this.safemode = safe;
  }

  /**
   * Check if tool calls require approval
   * @returns Array of pending approvals (empty if none needed)
   */
  hilCheck(toolCalls: ChatCompletionMessageToolCall[]): PendingApproval[] {
    if (!this.safemode) return [];

    const approvals: PendingApproval[] = [];

    for (const call of toolCalls) {
      if (call.type !== "function" || !call.function) continue;

      if (this.requiresApproval(call.function.name)) {
        approvals.push({
          tool_call: call,
          requires_approval: true,
          approval_status: { approval: "pending" },
          description: `Calling ${call.function.name} with ${call.function.arguments}`
        });
      }
    }

    return approvals;
  }

  private requiresApproval(toolName: string): boolean {

    return this.isEditingTool(toolName);

  }

  private isEditingTool(toolName: string): boolean {
    const EDITING_KEYWORDS = [
      'write', 'edit', 'send', 'create', 'delete',
      'update', 'patch', 'post', 'put', 'remove', 'add',
      'execute', 'command', 'run', 'shell'
    ];

    const normalized = toolName.toLowerCase();
    return EDITING_KEYWORDS.some(keyword => normalized.includes(keyword));
  }
}
