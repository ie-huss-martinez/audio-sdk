/**
 * The parts of the editor that `classNames` can target.
 *
 * @public
 */
export type AudioEditorPart =
  | "root"
  | "toolbar"
  | "notices"
  | "stage"
  | "timeline"
  | "transport"
  | "inspector";

/** Extra classes for the editor's parts. */
export type PartClassNames = Readonly<Partial<Record<AudioEditorPart, string>>>;

/** Joins class names, leaving out the empty ones. */
export function classes(...names: readonly (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
