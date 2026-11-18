import { Button, Dialog, Field, TextField } from "@hussmartinez/ui/react";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { MAX_TRACK_NAME_LENGTH } from "../core/model/plan.js";
import { useAudioEditorContext, useAudioSession } from "./context.js";

/**
 * The dialog that renames a track (docs/adr/0006), one for the editor, at
 * its root rather than in a track's header, so the header's arrow keys never
 * see the text field's. It's `ui`'s native dialog, which gives focus back to
 * the track's name when it closes.
 */
export function AudioRenameDialog(): ReactNode {
  const { messages, renaming, setRenaming } = useAudioEditorContext();
  const { session, snapshot } = useAudioSession();
  const track = snapshot.plan?.tracks.find((each) => each.key === renaming);
  const [draft, setDraft] = useState("");
  const form = useId();
  // The name's field takes focus when the dialog opens, ready to type.
  const field = useRef<HTMLInputElement>(null);

  // The draft starts from the name when another track's dialog opens, not
  // as the plan changes: set while rendering, as React advises for state
  // that follows a prop.
  const [opened, setOpened] = useState(renaming);
  if (opened !== renaming) {
    setOpened(renaming);
    setDraft(track?.name ?? "");
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (track) {
      // At most the format's length, counted in code points.
      const next = [...draft.trim()].slice(0, MAX_TRACK_NAME_LENGTH).join("");
      if (next !== track.name) {
        try {
          session.execute({ type: "audio.setTrack", key: track.key, name: next });
        } catch {
          // Refused: the name stays as it was.
        }
      }
    }
    setRenaming(undefined);
  };

  return (
    <Dialog
      open={track !== undefined}
      onOpenChange={(open) => {
        if (!open) setRenaming(undefined);
      }}
      title={messages.t("rename.title")}
      size="small"
      initialFocus={field}
      closeLabel={messages.t("editor.cancel")}
      footer={
        <>
          <Button onClick={() => setRenaming(undefined)}>{messages.t("editor.cancel")}</Button>
          <Button variant="primary" type="submit" form={form}>
            {messages.t("rename.save")}
          </Button>
        </>
      }
    >
      <form id={form} onSubmit={save}>
        <Field label={messages.t("rename.name")} description={messages.t("rename.description")}>
          <TextField ref={field} value={draft} onValueChange={setDraft} autoComplete="off" />
        </Field>
      </form>
    </Dialog>
  );
}
