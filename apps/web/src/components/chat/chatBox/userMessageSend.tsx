import AgentDropdown from "./agentDropdown";
import IconWrapper from "../../ui/iconWrapper";
import { createSignal } from "solid-js";
import { callstreamandhandleevents, state } from "../../../stores/chat.store";
import { selectedAgent } from "../../../stores/chatInput.store";

export default function UserMessageSend() {
  const [textmessage, setTextmessage] = createSignal("");
  let textareaRef: HTMLTextAreaElement | undefined;

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function send() {
    const agentId = selectedAgent();
    if (!agentId) throw new Error("No agent selected");
    callstreamandhandleevents(textmessage());
    setTextmessage("");
    if (textareaRef) {
      textareaRef.style.height = "auto";
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Send on Enter, new line on Shift+Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      <fieldset class="fieldset w-full">
        <AgentDropdown />
        <textarea
          ref={textareaRef}
          onInput={(e) => {
            setTextmessage(e.currentTarget.value);
            autoResize(e.currentTarget);
          }}
          onKeyDown={handleKeyDown}
          value={textmessage()}
          class="textarea textarea-ghost w-full resize-none p-0 min-h-8 max-h-32 overflow-y-auto leading-relaxed focus:outline-none"
          rows="1"
          placeholder="START TALKING TO PODLET ..."
        />
      </fieldset>
      <button
        onClick={send}
        class="btn btn-ghost flex flex-col items-center justify-center h-14 w-10 bg-base-300 border border-base-content/20 shadow-md active:shadow-inner active:scale-95 transition-transform shrink-0"
        classList={{ "btn-disabled": state.status === "running" || !selectedAgent() }}
      >
        <IconWrapper class="size-5 mb-0.5">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6.85046 13.4005C5.74589 13.4005 4.85046 12.5051 4.85046 11.4005V3.40051H2.85046V11.4005C2.85046 13.6097 4.64132 15.4005 6.85046 15.4005H17.156L13.3714 19.1852L14.7856 20.5994L21.1495 14.2354L14.7856 7.87146L13.3714 9.28567L17.4862 13.4005H6.85046Z" fill="currentColor" />
          </svg>
        </IconWrapper>
        <span class="text-[10px] leading-none opacity-60">ENTER</span>
      </button>
    </>
  );
}
