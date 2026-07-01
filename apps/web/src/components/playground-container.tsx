import { createSignal } from "solid-js";
import { ParentProps } from "solid-js";

export default function PlaygroundContainer(props: ParentProps) {
  const [device, setDevice] = createSignal("desktop");
  const [showGrid, setShowGrid] = createSignal(true);

  const widthClass = () => {
    switch (device()) {
      case "mobile": return "w-[375px]";
      case "tablet": return "w-[768px]";
      default: return "w-full max-w-[1200px]";
    }
  };

  return (
    <div
      data-theme="catppuccin-mocha"
      class="h-screen w-full flex flex-col bg-base-300 text-base-content overflow-hidden font-mono"
    >
      <header class="flex items-center justify-between px-6 py-3 bg-base-200 border-b border-neutral/30">
        <div class="flex items-center gap-6">
          <span class="text-xs uppercase tracking-widest font-bold text-primary">Component // Lab</span>
          <div class="join">
            <button
              class={`btn btn-xs join-item ${device() === 'mobile' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDevice("mobile")}
            >Mobile</button>
            <button
              class={`btn btn-xs join-item ${device() === 'tablet' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDevice("tablet")}
            >Tablet</button>
            <button
              class={`btn btn-xs join-item ${device() === 'desktop' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setDevice("desktop")}
            >Desktop</button>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <button
            class="btn btn-xs btn-outline btn-secondary"
            onClick={() => setShowGrid(!showGrid())}
          >
            {showGrid() ? "Hide Grid" : "Show Grid"}
          </button>
        </div>
      </header>

      <main
        class="relative flex-1 p-12 flex justify-center items-center overflow-auto"
        style={showGrid() ? {
          "background-image": `radial-gradient(circle, var(--color-neutral) 1px, transparent 1px)`,
          "background-size": "24px 24px"
        } : {}}
      >
        <div
          class={`
            @container
            ${widthClass()}
            h-full max-h-[80vh]
            bg-base-100
            border border-neutral
            transition-all duration-500 ease-in-out
            relative flex flex-col
          `}
        >
          <div class="flex-1 overflow-auto p-8 flex items-center justify-center">
            <div class="w-full h-full flex items-center justify-center">
              {props.children}
            </div>
          </div>
          <div class="absolute -bottom-6 right-0 text-[10px] text-neutral-content/50 uppercase font-mono">
            {device()} view // {widthClass().match(/\d+/)?.[0] || "Fluid"}px
          </div>
        </div>
      </main>
    </div>
  );
}
