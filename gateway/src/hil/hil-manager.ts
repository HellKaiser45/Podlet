import { LiteLLMMessage, HILConfig, PendingApproval } from "../types";

const hilConfig: HILConfig = {
  enabled: true,
  sensitive_tools: [
    'execute_command'
  ],
  //NOTE: this means i need to parse the tools names to check things like send , write, edit, ... in the name 
  auto_unapprove_editing_tools: true,
}

class HilManager {
  private lastMessage: LiteLLMMessage;
  private approvals: PendingApproval[] = [];

  constructor(message: LiteLLMMessage) {
    this.lastMessage = message;
  }

  hillCheck(): boolean {
    //TODO: Find and implement a way to mark tools as HIL required
    if (!this.lastMessage.tool_calls) {
      return false;
    }
    for (const call of this.lastMessage.tool_calls) {
      if (call.type === "function" && call.function) {
        if (hilConfig.sensitive_tools.includes(call.function.name)) {
          this.approvals.push({
            tool_call: call,
            requires_approval: true,
            approval_status: "pending",
            description: `calling ${call.function.name} with ${call.function.arguments}`
          })
        }
        elif(){

        }
      }
    }
  }
}
