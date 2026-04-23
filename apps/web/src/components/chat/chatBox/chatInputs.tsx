import IconWrapper from "../../ui/iconWrapper";
import PlusIcon from "../../ui/icons/plus";
import UserMessageSend from "./userMessageSend";
import AttachmentBadges from "../chatBox/attachmentBadges";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, attachments } from "../../../stores/attachements.store";
import { processFile } from "../../../stores/attachements.store";

export default function ChatInputs() {
  return (
    <div class="flex flex-col w-full max-w-2xl">
      <AttachmentBadges items={attachments()} />
      <div class="join justify-center items-center border border-base-content/20 bg-base-200 gap-2 p-1 focus-within:border-primary/50 focus-within:shadow-[0_0_0_2px] focus-within:shadow-primary/20 transition-all">
        <label class="btn btn-outline btn-secondary btn-circle btn-sm shrink-0 cursor-pointer">
          <input
            type="file"
            class="hidden"
            multiple
            accept={[
              ...ALLOWED_MIME_TYPES.image,
              ...ALLOWED_MIME_TYPES.text,
              ...[...ALLOWED_EXTENSIONS].map(ext => `.${ext}`),
            ].join(",")}
            onChange={(e) => {
              processFile(Array.from(e.currentTarget.files ?? []));
            }}
          />
          <IconWrapper class="size-4">
            <PlusIcon />
          </IconWrapper>
        </label>
        <UserMessageSend />
      </div>
    </div>

  )
}
