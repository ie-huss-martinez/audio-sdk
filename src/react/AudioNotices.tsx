import { CloseIcon, IconButton, useAnnounce } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { AudioWarning } from "../core/session/session.js";
import { audioWarningText } from "../messages/text.js";
import { useAudioEditorContext, useAudioSession } from "./context.js";
import { classes, type PartClassNames } from "./parts.js";

/**
 * A warning's kind: its limit, or its type. One notice per kind, which is
 * also what a dismissal hides, as video-sdk's notices are.
 */
function warningKind(warning: AudioWarning): string {
  return warning.type === "limit" ? `limit:${warning.limit}` : warning.type;
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
 * earliest edits can no longer be undone. There's one notice per kind of
 * warning, with that kind's different sentences, so two recordings that
 * raise the same warning don't say it twice. Each kind is announced once,
 * politely, when it first appears, since a warning after a successful insert
 * would otherwise go unheard; undo and redo never announce it again. Each
 * can be dismissed, and that kind doesn't come back. Inside an
 * {@link AudioEditorProvider}.
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

  // One notice per kind, with the kind's different sentences: two
  // recordings of the same length raise the same sentence, which twice would
  // only be noise. Keyed by kind, not by text, since a kind's text carries a
  // value, such as a length, and keying by it would bring a dismissed notice
  // back whenever the value changed.
  const kinds = new Map<string, Set<string>>();
  for (const warning of snapshot.warnings) {
    const kind = warningKind(warning);
    const texts = kinds.get(kind) ?? new Set<string>();
    texts.add(audioWarningText(messages, warning));
    kinds.set(kind, texts);
  }
  const items = [
    ...[...kinds].map(([key, texts]) => ({ key, text: [...texts].join(" ") })),
    ...(snapshot.historyTrimmed
      ? [{ key: "historyTrimmed", text: messages.t("editor.historyTrimmed") }]
      : []),
  ].filter((item) => !dismissed.has(item.key));

  // Each kind is said once, politely, the first time it appears, keyed as
  // the list is: not again on a re-render, nor when undo and redo bring it
  // back, and never once it's dismissed. Kinds that appear together are said
  // as one message. The history's notice has its own announcement, above.
  const announced = useRef(new Set<string>(["historyTrimmed"]));
  useEffect(() => {
    const fresh = items.filter((item) => !announced.current.has(item.key));
    if (fresh.length === 0) return;
    for (const item of fresh) announced.current.add(item.key);
    announce(fresh.map((item) => item.text).join(" "));
  });

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
