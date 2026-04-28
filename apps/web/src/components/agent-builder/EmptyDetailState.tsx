import { type Component } from "solid-js";
import PodletIcon from "../ui/icons/PodletIcon";

const steps = [
  { num: "01", text: "SELECT an agent from the roster" },
  { num: "02", text: "CONFIGURE model, skills, and directives" },
  { num: "03", text: "INITIATE to deploy to chat" },
];

const EmptyDetailState: Component = () => (
  <div class="flex items-center justify-center h-full min-h-[400px] p-8">
    <div class="flex flex-col items-center gap-6 border border-dashed border-base-content/10 rounded-lg py-12 px-8">
      <span class="text-lg font-mono font-bold uppercase text-primary">
        WELCOME_TO_THE_FORGE
      </span>

      <div class="w-[150px] h-[150px] animate-[gentle-pulse_3s_ease-in-out_infinite] [&>svg]:w-full [&>svg]:h-full">
        <PodletIcon />
      </div>

      <div class="flex flex-col items-start gap-1.5">
        {steps.map((s) => (
          <div class="text-[11px] font-mono text-base-content/40">
            <span class="text-primary">{s.num}</span> // {s.text}
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default EmptyDetailState;
