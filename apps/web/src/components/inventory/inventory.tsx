import { createSignal, createMemo, For, JSX, onMount, onCleanup, Show, createEffect } from "solid-js";
import InventorySlot from "./inventorySquare";

type Identifiable = { id: string };

type InventoryProps<T extends Identifiable> = {
  items: T[];
  type: "file" | "agent" | "model" | "mcp";
  renderItem: (item: T) => JSX.Element;
  slotSize?: number; // Default size of one square (e.g., 96 for w-24)
  gap?: number;      // Default gap (e.g., 8 for gap-2)
};

export default function Inventory<T extends Identifiable>(props: InventoryProps<T>) {

  let containerRef: HTMLDivElement | undefined;
  const [dim, setDim] = createSignal({ w: 0, h: 0 });
  const [page, setPage] = createSignal(0);

  // Sync with your Tailwind Container Query config
  // (Usually: sm: 384px, md: 448px, lg: 512px - adjust to match your tailwind.config)
  const getSlotMetrics = () => {
    const width = dim().w;
    if (width >= 512) return { size: 128, gap: 8 }; // lg: w-32
    if (width >= 384) return { size: 96, gap: 8 };  // md: w-24
    return { size: 64, gap: 8 };                   // sm: w-16
  };

  const ro = new ResizeObserver(([entry]) => {
    setDim({ w: entry.contentRect.width, h: entry.contentRect.height });
  });

  onMount(() => containerRef && ro.observe(containerRef));
  onCleanup(() => ro.disconnect());

  const layout = createMemo(() => {
    const { size, gap } = getSlotMetrics();
    const cols = Math.floor((dim().w + gap) / (size + gap)) || 1;
    const rows = Math.floor((dim().h + gap) / (size + gap)) || 1;
    return { cols, rows, perPage: cols * rows, size, gap };
  });

  const totalPages = createMemo(() => Math.ceil(props.items.length / layout().perPage));

  // Logic: Slice the items based on current page
  const visibleItems = createMemo(() => {
    const { perPage } = layout();
    const start = page() * perPage;
    const slice = props.items.slice(start, start + perPage);

    // Use a fixed length array to help Solid's reconciliation
    return Array.from({ length: perPage }, (_, i) => slice[i] ?? null);
  });

  createEffect(() => {
    const maxPage = totalPages() - 1;
    if (page() > maxPage && maxPage >= 0) {
      setPage(maxPage);
    }
  });

  return (
    <div ref={containerRef} class="w-full h-full flex flex-col @container">
      <div
        class="grid justify-center content-start flex-1"
        style={{
          "grid-template-columns": `repeat(${layout().cols}, ${layout().size}px)`,
          "gap": `${layout().gap}px`
        }}
      >
        <For each={visibleItems()}>
          {(item) => (
            <InventorySlot
              id={item?.id ?? ""}
              type={props.type}
            >
              {item ? props.renderItem(item) : undefined}
            </InventorySlot>
          )}
        </For>
      </div>

      <Show when={totalPages() > 1}>
        <div class="flex justify-between p-2 items-center bg-base-300/30 rounded-b-lg">
          <button class="btn btn-xs" onClick={() => setPage(p => Math.max(0, p - 1))}>«</button>
          <span class="text-[10px] font-bold">PAGE {page() + 1} / {totalPages()}</span>
          <button class="btn btn-xs" onClick={() => setPage(p => Math.min(totalPages() - 1, p + 1))}>»</button>
        </div>
      </Show>
    </div>
  );
}
