import { ChatCompletionMessageParam } from "@podlet/types";
import { For } from "solid-js";
import ChatBubble from "./chat-bubbles";
import ActivityPanel from "./ActivityPanel";

export default function Conversation(props: { messages: ChatCompletionMessageParam[] }) {
  return (
    <div class="flex flex-col gap-4">
      <For each={props.messages}>
        {(message) => <ChatBubble message={message} />}
      </For>
      <ActivityPanel />
    </div>
  );
}
