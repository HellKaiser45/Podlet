import { LiteLLMMessage, HILConfig, PendingApproval } from "../types";

const hilConfig: HILConfig = {
  enabled: true,
  sensitive_tools: [
    'execute_command'
  ],
  //NOTE: this means i need to parse the tools names to check things like send , write, edit, ... in the name 
  auto_unapprove_editing_tools: true,
}

export class HilManager {
  private approvals: PendingApproval[] = [];

  constructor() { }

  hillCheck(message: LiteLLMMessage): boolean {
    // Clear previous approvals to allow manager reuse
    this.approvals = [];

    //TODO: Find and implement a way to mark tools as HIL required
    if (!message.tool_calls) {
      return false;
    }
    for (const call of message.tool_calls) {
      if (call.type === "function" && call.function) {
        if (hilConfig.sensitive_tools.includes(call.function.name)) {
          this.approvals.push({
            tool_call: call,
            requires_approval: true,
            approval_status: "pending",
            description: `calling ${call.function.name} with ${call.function.arguments}`
          })
        }
        else if (hilConfig.auto_unapprove_editing_tools) {
          const EDITING_KEYWORDS = ['write', 'edit', 'send', 'create', 'delete', 'update', 'patch', 'post', 'put', 'remove', 'add'];
          const toolName = call.function.name.toLowerCase();

          const isEditingTool = EDITING_KEYWORDS.some(keyword => toolName.includes(keyword));

          if (isEditingTool) {
            this.approvals.push({
              tool_call: call,
              requires_approval: true,
              approval_status: "pending",
              description: `calling ${call.function.name} with ${call.function.arguments}`
            });
          }
        }
      }
    }
    return this.approvals.length > 0;
  }

  getApprovals(): PendingApproval[] {
    return this.approvals;
  }
}
