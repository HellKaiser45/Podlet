import { createSignal, createEffect, For, Show, onCleanup } from 'solid-js'
import { useParams, useNavigate } from '@solidjs/router'

interface Thread {
  id: string
  title: string
  updatedAt: Date
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  isStreaming?: boolean
}

const MOCK_THREADS: Thread[] = [
  { id: '1', title: 'Project architecture review', updatedAt: new Date() },
  { id: '2', title: 'Debug SSE streaming', updatedAt: new Date() },
  { id: '3', title: 'Monorepo setup with Bun', updatedAt: new Date() },
]

export default function Chat() {
  const params = useParams<{ threadId?: string }>()
  const navigate = useNavigate()

  const [threads, setThreads] = createSignal<Thread[]>(MOCK_THREADS)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [input, setInput] = createSignal('')
  const [streaming, setStreaming] = createSignal(false)
  const [sidebarOpen, setSidebarOpen] = createSignal(true)
  const [activeThreadId, setActiveThreadId] = createSignal<string | undefined>(params.threadId)

  let messagesEndRef: HTMLDivElement | undefined
  let inputRef: HTMLTextAreaElement | undefined
  let eventSource: EventSource | undefined

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: 'smooth' })
  }

  createEffect(() => {
    messages()
    scrollToBottom()
  })

  onCleanup(() => {
    eventSource?.close()
  })

  const newThread = () => {
    const id = crypto.randomUUID()
    const thread: Thread = {
      id,
      title: 'New conversation',
      updatedAt: new Date(),
    }
    setThreads(prev => [thread, ...prev])
    setMessages([])
    setActiveThreadId(id)
    navigate(`/chat/${id}`)
    inputRef?.focus()
  }

  const selectThread = (id: string) => {
    setActiveThreadId(id)
    navigate(`/chat/${id}`)
    setMessages([]) // load from store/api in real app
  }

  const handleSend = async () => {
    const text = input().trim()
    if (!text || streaming()) return

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    }

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)

    // SSE stream from BFF → Gateway
    // Replace with your actual @podlet/api-client call
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: activeThreadId() ?? crypto.randomUUID(),
          runId: crypto.randomUUID(),
          message: { role: 'user', content: text },
          state: {},
          tools: [],
          context: [],
          forwardedProps: { agentId: 'default' },
        }),
      })

      if (!res.body) throw new Error('No body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value)
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const trimmed = part.trim()
          if (!trimmed.startsWith('data: ')) continue
          const data = trimmed.slice(6)
          if (data === '[DONE]') break

          try {
            const event = JSON.parse(data)
            if (event.type === 'TEXT_MESSAGE_CHUNK' && event.delta) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantMsg.id
                    ? { ...m, content: m.content + event.delta }
                    : m
                )
              )
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      console.error('Stream error:', err)
    } finally {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsg.id ? { ...m, isStreaming: false } : m
        )
      )
      setStreaming(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const autoResize = (e: Event) => {
    const el = e.target as HTMLTextAreaElement
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  return (
    <div class="drawer lg:drawer-open h-screen bg-base-100">
      <input id="drawer-toggle" type="checkbox" class="drawer-toggle"
        checked={sidebarOpen()}
        onChange={e => setSidebarOpen(e.currentTarget.checked)}
      />

      {/* Sidebar */}
      <div class="drawer-side z-40">
        <label for="drawer-toggle" class="drawer-overlay" />
        <aside class="flex flex-col w-72 h-full bg-base-200 border-r border-base-300">

          {/* Logo */}
          <div class="flex items-center gap-2 px-4 py-4 border-b border-base-300">
            <div class="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <svg class="w-4 h-4 text-primary-content" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <span class="font-semibold text-base-content tracking-tight">Podlet</span>
          </div>

          {/* New chat button */}
          <div class="px-3 pt-3">
            <button class="btn btn-ghost btn-sm w-full justify-start gap-2 text-base-content/70 hover:text-base-content"
              onClick={newThread}>
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              New conversation
            </button>
          </div>

          {/* Thread list */}
          <div class="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
            <p class="text-xs font-medium text-base-content/40 px-2 py-1 uppercase tracking-wider">Recent</p>
            <For each={threads()}>
              {thread => (
                <button
                  class={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors truncate
                    ${activeThreadId() === thread.id
                      ? 'bg-base-300 text-base-content font-medium'
                      : 'text-base-content/70 hover:bg-base-300/50 hover:text-base-content'
                    }`}
                  onClick={() => selectThread(thread.id)}
                >
                  {thread.title}
                </button>
              )}
            </For>
          </div>

          {/* Footer */}
          <div class="border-t border-base-300 p-3">
            <button class="btn btn-ghost btn-sm w-full justify-start gap-2 text-base-content/60">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Settings
            </button>
          </div>
        </aside>
      </div>

      {/* Main content */}
      <div class="drawer-content flex flex-col h-screen">

        {/* Top bar (mobile) */}
        <div class="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-base-200">
          <label for="drawer-toggle" class="btn btn-ghost btn-sm btn-square">
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </label>
          <span class="font-semibold text-sm">Podlet</span>
        </div>

        {/* Messages area */}
        <div class="flex-1 overflow-y-auto">
          <Show
            when={messages().length > 0}
            fallback={<EmptyState onSuggestion={s => { setInput(s); inputRef?.focus() }} />}
          >
            <div class="max-w-3xl mx-auto px-4 py-8 space-y-6">
              <For each={messages()}>
                {msg => <MessageBubble message={msg} />}
              </For>
              <div ref={messagesEndRef} />
            </div>
          </Show>
        </div>

        {/* Input area */}
        <div class="border-t border-base-200 bg-base-100 px-4 py-4">
          <div class="max-w-3xl mx-auto">
            <div class="relative flex items-end gap-2 bg-base-200 rounded-2xl px-4 py-3 border border-base-300 focus-within:border-primary transition-colors">
              <textarea
                ref={inputRef}
                class="flex-1 resize-none bg-transparent text-base-content placeholder:text-base-content/40 text-sm leading-relaxed outline-none min-h-[24px] max-h-40"
                placeholder="Message Podlet..."
                value={input()}
                rows={1}
                onInput={e => { setInput(e.currentTarget.value); autoResize(e) }}
                onKeyDown={handleKeyDown}
                disabled={streaming()}
              />
              <button
                class={`btn btn-sm btn-circle flex-shrink-0 transition-all
                  ${input().trim() && !streaming()
                    ? 'btn-primary'
                    : 'btn-ghost text-base-content/30 cursor-not-allowed'
                  }`}
                onClick={handleSend}
                disabled={!input().trim() || streaming()}
              >
                <Show
                  when={!streaming()}
                  fallback={<span class="loading loading-spinner loading-xs" />}
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                      d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Show>
              </button>
            </div>
            <p class="text-center text-xs text-base-content/30 mt-2">
              Shift+Enter for new line · Enter to send
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble(props: { message: Message }) {
  const isUser = () => props.message.role === 'user'

  return (
    <div class={`flex gap-3 ${isUser() ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div class={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold
        ${isUser() ? 'bg-primary text-primary-content' : 'bg-base-300 text-base-content'}`}>
        {isUser() ? 'U' : 'P'}
      </div>

      {/* Bubble */}
      <div class={`max-w-[80%] ${isUser() ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <Show when={props.message.thinking}>
          <div class="text-xs text-base-content/40 italic px-1">
            {props.message.thinking}
          </div>
        </Show>

        <div class={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
          ${isUser()
            ? 'bg-primary text-primary-content rounded-tr-sm'
            : 'bg-base-200 text-base-content rounded-tl-sm'
          }`}>
          {props.message.content}
          <Show when={props.message.isStreaming}>
            <span class="inline-block w-1.5 h-4 bg-current opacity-70 ml-0.5 animate-pulse rounded-sm align-middle" />
          </Show>
        </div>
      </div>
    </div>
  )
}

function EmptyState(props: { onSuggestion: (s: string) => void }) {
  const suggestions = [
    'How does my agent orchestration work?',
    'Review my Elysia gateway structure',
    'Help me design the BFF auth layer',
    'Explain SSE streaming patterns',
  ]

  return (
    <div class="flex flex-col items-center justify-center h-full px-4 py-16 text-center">
      <div class="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <svg class="w-6 h-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      </div>
      <h2 class="text-xl font-semibold text-base-content mb-1">How can I help?</h2>
      <p class="text-base-content/50 text-sm mb-8 max-w-sm">
        Start a conversation or pick a suggestion below.
      </p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
        <For each={suggestions}>
          {s => (
            <button
              class="btn btn-ghost btn-sm text-left justify-start h-auto py-3 px-4 border border-base-300 hover:border-primary/30 hover:bg-primary/5 rounded-xl text-sm text-base-content/70 normal-case font-normal whitespace-normal"
              onClick={() => props.onSuggestion(s)}
            >
              {s}
            </button>
          )}
        </For>
      </div>
    </div>
  )
}
