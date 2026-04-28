import { type Component, createSignal, Show, Switch, Match, For } from "solid-js";
import {
  prompts,
  selectedAgent,
  promptContent,
  promptLoading,
  promptMode,
  promptSaving,
  viewPrompt,
  editPrompt,
  savePromptContent,
  createNewPrompt,
  deletePromptAndClear,
  equipPrompt,
  closePrompt,
  startCreatePrompt,
} from "../../stores/agent-builder.store";

const PromptEditor: Component = () => {
  const [editText, setEditText] = createSignal("");
  const [newFilename, setNewFilename] = createSignal("");
  const [newText, setNewText] = createSignal("");
  const [confirmDeleteState, setConfirmDeleteState] = createSignal(false);

  const handleSelectPrompt = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val) equipPrompt(val);
  };

  const startEdit = () => {
    setEditText(promptContent());
    editPrompt();
  };

  const cancelEdit = () => {
    setEditText("");
    closePrompt();
  };

  const cancelCreate = () => {
    setNewFilename("");
    setNewText("");
    closePrompt();
  };

  const handleSave = () => {
    const agent = selectedAgent();
    if (agent?.system_prompt) {
      savePromptContent(agent.system_prompt, editText());
    }
  };

  const handleCreate = () => {
    if (newFilename().trim()) {
      createNewPrompt(newFilename().trim(), newText());
    }
  };

  const handleDeleteConfirm = () => {
    const agent = selectedAgent();
    if (agent?.system_prompt) {
      deletePromptAndClear(agent.system_prompt);
    }
    setConfirmDeleteState(false);
  };

  return (
    <div class="space-y-2">
      {/* ── Header Row ── */}
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-bold uppercase tracking-widest text-primary">
          CORE_DIRECTIVES
        </span>
        <div class="flex items-center gap-1">
          <Show
            when={
              selectedAgent()?.system_prompt &&
              promptMode() === "closed"
            }
          >
            <button
              class="btn btn-xs btn-ghost text-primary"
              onClick={() => {
                const sp = selectedAgent()?.system_prompt;
                if (sp) viewPrompt(sp);
              }}
              title="View prompt"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                class="w-4 h-4"
              >
                <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                <path
                  fill-rule="evenodd"
                  d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                  clip-rule="evenodd"
                />
              </svg>
              VIEW
            </button>
          </Show>
          <button
            class="btn btn-xs btn-ghost text-primary"
            onClick={startCreatePrompt}
            title="New prompt"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              class="w-4 h-4"
            >
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            +NEW
          </button>
        </div>
      </div>

      {/* ── Select Row ── */}
      <div class="flex items-center gap-2">
        <select
          class="select select-xs select-bordered bg-base-200 max-w-[200px]"
          value={selectedAgent()?.system_prompt ?? ""}
          onChange={handleSelectPrompt}
        >
          <option value="" disabled>
            SELECT_PROMPT...
          </option>
          <For each={prompts()}>
            {(p) => <option value={p}>{p}</option>}
          </For>
        </select>
        <Show
          when={selectedAgent()?.system_prompt}
          fallback={
            <span class="text-base-content/30 text-xs">
              NO_PROMPT_EQUIPPED
            </span>
          }
        >
          <span class="badge badge-xs badge-primary">EQUIPPED</span>
        </Show>
      </div>

      {/* ── Expanded Content ── */}
      <Show when={promptMode() !== "closed"}>
        <div class="relative border border-base-300 rounded-lg bg-base-100 p-3">
          {/* Close button */}
          <button
            class="btn btn-xs btn-ghost absolute top-2 right-2"
            onClick={() => {
              setConfirmDeleteState(false);
              closePrompt();
            }}
            title="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              class="w-4 h-4"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>

          <Switch>
            {/* ── Viewing ── */}
            <Match when={promptMode() === "viewing"}>
              <Show
                when={!promptLoading()}
                fallback={
                  <div class="text-base-content/50 text-sm py-4">
                    LOADING...
                  </div>
                }
              >
                <div class="bg-base-200 rounded-lg p-3 text-sm font-mono whitespace-pre-wrap min-h-[200px] max-h-[300px] overflow-y-auto">
                  {promptContent()}
                </div>

                <Show when={confirmDeleteState()}>
                  <div class="flex items-center gap-2 mt-2 p-2 bg-error/10 rounded-lg border border-error/30">
                    <span class="text-error text-xs font-bold">
                      CONFIRM_DELETE?
                    </span>
                    <button
                      class="btn btn-xs btn-error"
                      onClick={handleDeleteConfirm}
                    >
                      YES
                    </button>
                    <button
                      class="btn btn-xs btn-ghost"
                      onClick={() => setConfirmDeleteState(false)}
                    >
                      NO
                    </button>
                  </div>
                </Show>

                <Show when={!confirmDeleteState()}>
                  <div class="flex items-center gap-1 mt-2">
                    <button
                      class="btn btn-xs btn-ghost text-warning"
                      onClick={startEdit}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="w-3.5 h-3.5"
                      >
                        <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                      </svg>
                      EDIT
                    </button>
                    <button
                      class="btn btn-xs btn-ghost text-error"
                      onClick={() => setConfirmDeleteState(true)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        class="w-3.5 h-3.5"
                      >
                        <path
                          fill-rule="evenodd"
                          d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
                          clip-rule="evenodd"
                        />
                      </svg>
                      DELETE
                    </button>
                  </div>
                </Show>
              </Show>
            </Match>

            {/* ── Editing ── */}
            <Match when={promptMode() === "editing"}>
              <textarea
                class="textarea textarea-bordered w-full font-mono text-sm min-h-[200px] max-h-[300px] resize-y bg-base-200"
                value={editText()}
                onInput={(e) => setEditText(e.currentTarget.value)}
                spellcheck={false}
              />
              <div class="flex items-center gap-1 mt-2">
                <button class="btn btn-xs btn-ghost" onClick={cancelEdit}>
                  CANCEL
                </button>
                <button
                  class="btn btn-xs btn-primary"
                  disabled={promptSaving()}
                  onClick={handleSave}
                >
                  SAVE
                </button>
              </div>
            </Match>

            {/* ── Creating ── */}
            <Match when={promptMode() === "creating"}>
              <div class="flex items-center gap-2 mb-2">
                <span class="text-[10px] font-bold uppercase tracking-widest text-base-content/60">
                  FILENAME
                </span>
                <input
                  type="text"
                  class="input input-xs input-bordered bg-base-200 flex-1"
                  value={newFilename()}
                  onInput={(e) => setNewFilename(e.currentTarget.value)}
                  placeholder="prompt-name"
                  spellcheck={false}
                />
                <span class="text-xs text-base-content/50">.md</span>
              </div>
              <textarea
                class="textarea textarea-bordered w-full font-mono text-sm min-h-[200px] max-h-[300px] resize-y bg-base-200"
                value={newText()}
                onInput={(e) => setNewText(e.currentTarget.value)}
                spellcheck={false}
              />
              <div class="flex items-center gap-1 mt-2">
                <button class="btn btn-xs btn-ghost" onClick={cancelCreate}>
                  CANCEL
                </button>
                <button
                  class="btn btn-xs btn-primary"
                  disabled={!newFilename().trim() || promptSaving()}
                  onClick={handleCreate}
                >
                  CREATE
                </button>
              </div>
            </Match>
          </Switch>
        </div>
      </Show>
    </div>
  );
};

export default PromptEditor;
