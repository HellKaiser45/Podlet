import { For } from "solid-js";
import IconWrapper from "../../ui/iconWrapper";
import FileIcon from "../../ui/icons/fileIcon";
import { removeAttachment } from "../../../stores/attachements.store";

type BadgeItem = { name: string, type: "text" | "image" }
type Props = { items?: BadgeItem[] }

export default function AttachmentBadges(props: Props) {
  return (
    <div class="flex gap-1 mb-0.5 flex-wrap">
      <For each={props.items ?? []}>
        {(item) => (
          <div class="badge text-base-content/66 text-xs">
            <IconWrapper class="size-3">
              <FileIcon file={{ id: 'tshf', type: item.type, name: 'file', vpath: "osef" }} />
            </IconWrapper>
            {item.name}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke-width="2.5"
              stroke="currentColor"
              class="size-4 hover:text-error"
              onClick={() => removeAttachment(item.name)}
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </div>
        )}
      </For>
    </div>
  );
}
