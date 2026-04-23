import { ChatCompletionMessageParam } from "@podlet/types";
import { Marked } from 'marked';
import { markedHighlight } from "marked-highlight";
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import IconWrapper from "../ui/iconWrapper";
import PodletIcon from "../ui/icons/PodletIcon";
import { createMemo } from "solid-js";

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

marked.setOptions({
  gfm: true,
  breaks: true,
});

function extractContent(content: ChatCompletionMessageParam['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter(part => part.type === 'text')
    .map(part => part.type === 'text' ? part.text : '')
    .join('');
}

export default function ChatBubble(props: { message: ChatCompletionMessageParam }) {
  const content = () => extractContent(props.message.content);

  const renderedHtml = createMemo(() => {
    return marked.parse(content()) as string;
  });

  return props.message.role === 'user' ? (
    <div class="@container chat chat-end mb-2">
      <div class="chat-bubble chat-bubble-primary max-w-[85%] @md:max-w-[70%]">
        {content()}
      </div>
    </div>
  ) : (
    <div class="chat chat-start mb-2 w-full">
      <div class="chat-header opacity-60 text-sm mb-1">
        <IconWrapper class="size-6">
          <PodletIcon />
        </IconWrapper>
        <span class="ml-1">【PODLET】</span>
      </div>

      {/* 2. THE STYLING FIX */}
      <div class="chat-bubble chat-bubble-neutral p-4 max-w-[90%] overflow-x-auto">
        <div
          class="prose prose-sm prose-invert max-w-none 
                 prose-table:table-auto prose-table:w-full prose-table:border-collapse
                 prose-th:border prose-th:p-2 prose-th:bg-base-300
                 prose-td:border prose-td:p-2
                 prose-pre:p-0 prose-pre:bg-transparent"
          innerHTML={renderedHtml()}
        />
      </div>
    </div>
  );
}
