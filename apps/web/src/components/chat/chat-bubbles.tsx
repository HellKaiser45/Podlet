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

/**
 * Extract plain text from a message for markdown rendering.
 * Filters out image_url blocks — only text remains.
 */
function extractText(content: ChatCompletionMessageParam['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((part: any) => part.type === 'text')
    .map((part: any) => part.text ?? '')
    .join('');
}

/**
 * Check if a message contains image blocks.
 */
function hasImages(content: ChatCompletionMessageParam['content']): boolean {
  if (typeof content === 'string') return false;
  return Array.isArray(content) && content.some((part: any) => part.type === 'image_url');
}

/**
 * Extract image URLs from a message content array.
 */
function extractImages(content: ChatCompletionMessageParam['content']): string[] {
  if (typeof content === 'string') return [];
  return content
    ?.filter((part: any) => part.type === 'image_url')
    .map((part: any) => part.image_url?.url ?? '')
    ?? [];
}

export default function ChatBubble(props: { message: ChatCompletionMessageParam }) {
  const content = () => props.message.content;
  const isUser = () => props.message.role === 'user';

  const renderedHtml = createMemo(() => {
    return marked.parse(extractText(content())) as string;
  });

  const images = createMemo(() => extractImages(content()));
  const hasImageBlocks = createMemo(() => hasImages(content()));

  // User message bubble: show text + image previews
  if (isUser()) {
    return (
      <div class="chat chat-end mb-2">
        <div class="chat-bubble chat-bubble-primary max-w-[85%] @md:max-w-[70%] flex flex-col gap-2">
          {/* Text part */}
          <div>{extractText(content())}</div>
          {/* Image previews */}
          {hasImageBlocks() && (
            <div class="flex flex-wrap gap-2">
              {images().map(url => (
                <img
                  src={url}
                  alt="User attachment"
                  class="max-h-48 max-w-full rounded-lg object-contain"
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Assistant message bubble: markdown rendering (no image support)
  return (
    <div class="chat chat-start mb-2 w-full">
      <div class="chat-header opacity-60 text-sm mb-1">
        <IconWrapper class="size-6">
          <PodletIcon />
        </IconWrapper>
        <span class="ml-1">【PODLET】</span>
      </div>

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
