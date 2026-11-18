import { CloseIcon, IconButton, useAnnounce } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AudioWarning } from "../core/session/session.js";
import { audioWarningText } from "../messages/text.js";
import { useAudioEditorContext, useAudioSession } from "./context.js";
import { classes, type PartClassNames } from "./parts.js";

/** A warning's identity: its kind, its limit and its source, so a dismissal holds for that one. */
function warningKey(warning: AudioWarning): string {
  return warning.type === "limit"
    ? `limit:${warning.limit}:${warning.source ?? ""}`
    : `${warning.type}:${warning.source}`;
}

/**
 * Props of {@link AudioNotices}.
 *
 * @public
 */
export interface AudioNoticesProps {
  readonly className?: string;
}

/**
 * The session's warnings, as one notice above the timeline (docs/adr/0005):
 * a long recording, a truncated file, a large session, and that the
 * earliest edits can no longer be undone. Each can be dismissed, and doesn't
 * come back for the same source. Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioNotices({ className }: AudioNoticesProps): ReactNode {
  return <Notices className={className} classNames={undefined} />;
}

/** The notices, with the editor's part classes. */
export function Notices({
  className,
  classNames,
}: {
  readonly className?: string | undefined;
  readonly classNames: PartClassNames | undefined;
}): ReactNode {
  const { messages } = useAudioEditorContext();
  const { snapshot } = useAudioSession();
  const announce = useAnnounce();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

  // When early steps are dropped to make room, say so once, politely
  // (docs/adr/0004).
  const trimmed = useRef(snapshot.historyTrimmed);
  useEffect(() => {
    if (snapshot.historyTrimmed && !trimmed.current) {
      announce(messages.t("editor.historyTrimmed"));
    }
    trimmed.current = snapshot.historyTrimmed;
  }, [snapshot.historyTrimmed, announce, messages]);

  const items = [
    ...snapshot.warnings.map((warning) => ({
      key: warningKey(warning),
      text: audioWarningText(messages, warning),
    })),
    ...(snapshot.historyTrimmed
      ? [{ key: "historyTrimmed", text: messages.t("editor.historyTrimmed") }]
      : []),
  ].filter((item) => !dismissed.has(item.key));
  if (items.length === 0) return null;

  return (
    <section
      className={classes("hm-audio-editor-notices", classNames?.notices, className)}
      aria-label={messages.t("editor.notices")}
    >
      <ul>
        {items.map((item) => (
          <li key={item.key}>
            <p>{item.text}</p>
            <IconButton
              variant="quiet"
              size="small"
              label={messages.t("editor.dismiss")}
              icon={<CloseIcon />}
              onClick={() => setDismissed((keys) => new Set([...keys, item.key]))}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
