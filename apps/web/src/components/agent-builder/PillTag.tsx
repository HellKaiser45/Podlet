import { type Component } from "solid-js";

interface PillTagProps {
  name: string;
  onRemove: () => void;
  color?: string;
}

const PillTag: Component<PillTagProps> = (props) => (
  <div
    class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-bold uppercase truncate max-w-[140px] ${
      props.color ?? "bg-primary/10 text-primary border border-primary/30"
    }`}
  >
    <span class="truncate">{props.name}</span>
    <button
      onClick={props.onRemove}
      class="opacity-50 hover:opacity-100 transition-opacity shrink-0 leading-none"
      aria-label={`Remove ${props.name}`}
    >
      <span class="material-symbols-outlined" style={{ "font-size": "14px" }}>close</span>
    </button>
  </div>
);

export default PillTag;
