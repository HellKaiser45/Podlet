import { type Component } from "solid-js";
import { executeDelete, cancelDelete } from "../../stores/agent-builder.store";

const DeleteConfirmBanner: Component = () => (
  <div class="bg-error/10 border border-error/30 p-3 flex flex-col gap-2">
    <div class="text-xs text-error font-bold">
      CONFIRM_DELETION: This action is irreversible.
    </div>
    <div class="flex gap-2">
      <button class="btn btn-error btn-xs" onClick={executeDelete}>
        CONFIRM
      </button>
      <button class="btn btn-ghost btn-xs" onClick={cancelDelete}>
        CANCEL
      </button>
    </div>
  </div>
);

export default DeleteConfirmBanner;
