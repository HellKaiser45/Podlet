import { createSignal, JSX } from "solid-js";
import { setHoveredItem } from "../../stores/inventory-store";

type Size = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<Size, string> = {
  sm: "@sm:w-16 @sm:h-16",
  md: "@md:w-24 @md:h-24 ",
  lg: "@lg:w-32 @lg:h-32 @lg:text-base",
};

type inventorySlotProps = {
  children: JSX.Element,
  id: string,
  type: "file" | "agent" | "model" | "mcp",
}

export default function InventorySlot(props?: inventorySlotProps) {
  const hasChildren = () => Boolean(props?.children);

  const sharedProps = `aspect-square text-xs p-1 flex flex-col items-center justify-center gap-1 transition-all duration-150 ease-in-out`

  const [InteractionState, setInteractionState] = createSignal<"default" | "hover">("default");

  const hoverOn = () => {
    setInteractionState("hover");
    if (props) setHoveredItem({ type: props.type, id: props.id });
  };

  return (
    <div
      // We keep the container queries for visual scaling
      class={`${sharedProps} ${SIZE_CLASSES.sm} ${SIZE_CLASSES.md} ${SIZE_CLASSES.lg}`}
      classList={{
        "bg-base-200/60 border border-base-content/20": hasChildren(),
        "bg-base-200/20 border border-base-content/10": !hasChildren(),
        "border-primary text-primary bg-primary/10": InteractionState() === 'hover',
      }}
      onMouseEnter={hoverOn}
      onMouseLeave={() => setInteractionState("default")}
      onMouseUp={hoverOn}
    >
      {props?.children || <div class="w-full h-full" />}
    </div>
  );
}
