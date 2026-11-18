import { useEffect, useState } from "react";

/**
 * A value a control changes as it's dragged or typed, committed once when
 * the gesture ends, so a drag is one undo step. It follows the committed
 * value whenever that changes, as after an undo.
 *
 * @returns The draft, its setter, and `commit`, which calls `onCommit` with
 *   the draft when it differs from the value.
 */
export function useDraft<T>(
  value: T,
  onCommit: (draft: T) => void,
): readonly [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (!Object.is(draft, value)) onCommit(draft);
  };
  return [draft, setDraft, commit];
}
