import { HILConfig, PendingApproval } from "../types";
import { ChatCompletionMessageToolCall } from "openai/resources/index";

const hilConfig: HILConfig = {
  enabled: false,
  sensitive_tools: ['execute_shell'],
  auto_unapprove_editing_tools: true,
};

export class HilManager {
  private config: HILConfig;

  constructor(config: HILConfig = hilConfig) {
    this.config = config;
  }

  /**
   * Check if tool calls require approval
   * @returns Array of pending approvals (empty if none needed)
   */
  hilCheck(toolCalls: ChatCompletionMessageToolCall[]): PendingApproval[] {
    if (!this.config.enabled) return [];

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
    // Check explicit sensitive tools
    if (this.config.sensitive_tools.includes(toolName)) {
      return true;
    }

    // Check editing keywords
    if (this.config.auto_unapprove_editing_tools) {
      return this.isEditingTool(toolName);
    }

    return false;
  }

  private isEditingTool(toolName: string): boolean {
    const EDITING_KEYWORDS = [
      'write', 'edit', 'send', 'create', 'delete',
      'update', 'patch', 'post', 'put', 'remove', 'add'
    ];

    const normalized = toolName.toLowerCase();
    return EDITING_KEYWORDS.some(keyword => normalized.includes(keyword));
  }
}
