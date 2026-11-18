import { useEffect, useState } from "react";

/**
 * Local state that follows a value whenever the value changes, as after an
 * undo, and moves on its own in between: a slider's thumb while it's
 * dragged, before `onValueCommit` applies the change.
 */
export function useFollowing<T>(value: T): readonly [T, (next: T) => void] {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return [local, setLocal];
}

/**
 * A text field's typing, committed once, with Enter or by leaving the
 * field, so typing is one undo step.
 *
 * @returns The draft, its setter, and `commit`, which calls `onCommit` with
 *   the draft when it differs from the value.
 */
export function useDraft<T>(
  value: T,
  onCommit: (draft: T) => void,
): readonly [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useFollowing(value);
  const commit = () => {
    if (!Object.is(draft, value)) onCommit(draft);
  };
  return [draft, setDraft, commit];
}
