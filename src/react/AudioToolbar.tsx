import {
  AddIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  FitIcon,
  IconButton,
  type IconComponent,
  MoveDownIcon,
  MoveUpIcon,
  MutedIcon,
  OpenIcon,
  PanIcon,
  PlayIcon,
  RedoIcon,
  RemoveIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SplitIcon,
  ToggleButton,
  Toolbar,
  ToolbarGroup,
  TrimEndIcon,
  TrimStartIcon,
  UndoIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useRef } from "react";
import { ACCEPT } from "./AudioStage.js";
import { useAudioEditorContext } from "./context.js";
import { classes, type PartClassNames } from "./parts.js";
import { useAudioTools } from "./tools.js";

/** The icons the tools name, from ui's set. */
const ICONS: Readonly<Record<string, IconComponent>> = {
  open: OpenIcon,
  upload: UploadIcon,
  undo: UndoIcon,
  redo: RedoIcon,
  add: AddIcon,
  remove: RemoveIcon,
  "move-up": MoveUpIcon,
  "move-down": MoveDownIcon,
  muted: MutedIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  fit: FitIcon,
  play: PlayIcon,
  "skip-back": SkipBackIcon,
  "skip-forward": SkipForwardIcon,
  split: SplitIcon,
  delete: DeleteIcon,
  "trim-start": TrimStartIcon,
  "trim-end": TrimEndIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-right": ChevronRightIcon,
  close: CloseIcon,
  pan: PanIcon,
};

/** The message key that names each default toolbar group. */
const GROUP_LABELS = {
  file: "toolbar.file",
  history: "toolbar.history",
  tracks: "toolbar.tracks",
  clips: "toolbar.clips",
  range: "toolbar.range",
  view: "toolbar.view",
} as const;

/**
 * Props of {@link AudioToolbar}.
 *
 * @public
 */
export interface AudioToolbarProps {
  readonly className?: string;
}

/**
 * The editor's toolbar (docs/adr/0005): a `ui` Toolbar of the present
 * tools, in the groups the `toolbar` prop sets. Each button has the tool's
 * label, its shortcuts as `aria-keyshortcuts`, and a tooltip with the keys.
 * A tool that can't run now stays in the keyboard order, with
 * `aria-disabled`. Inside an {@link AudioEditorProvider}.
 *
 * @public
 */
export function AudioToolbar({ className }: AudioToolbarProps): ReactNode {
  return <EditorToolbar className={className} classNames={undefined} />;
}

/** The toolbar, with the editor's part classes. */
export function EditorToolbar({
  className,
  classNames,
}: {
  readonly className?: string | undefined;
  readonly classNames: PartClassNames | undefined;
}): ReactNode {
  const { messages, tools, fileChooser, open, insert } = useAudioEditorContext();
  const { flags, run, ariaKeyShortcuts, labelWithKeys } = useAudioTools();
  const picker = useRef<HTMLInputElement>(null);
  const purpose = useRef<"open" | "insert">("open");

  useEffect(() => {
    const chooser = (next: "open" | "insert") => {
      purpose.current = next;
      picker.current?.click();
    };
    fileChooser.current = chooser;
    return () => {
      if (fileChooser.current === chooser) fileChooser.current = null;
    };
  }, [fileChooser]);

  if (tools.toolbar.length === 0) return null;
  return (
    <>
      <Toolbar
        className={classes("hm-audio-editor-toolbar", classNames?.toolbar, className)}
        label={messages.t("toolbar.label")}
      >
        {tools.toolbar.map((group) => {
          const name = group[0]?.group as keyof typeof GROUP_LABELS | undefined;
          const label = name && GROUP_LABELS[name] ? messages.t(GROUP_LABELS[name]) : "";
          return (
            <ToolbarGroup key={group.map((tool) => tool.id).join(" ")} label={label}>
              {group.map((tool) => {
                const state = flags.get(tool.id) ?? { enabled: false, active: false };
                const Icon = ICONS[tool.icon] ?? AddIcon;
                const common = {
                  label: messages.t(tool.label as "tools.undo"),
                  icon: <Icon />,
                  title: labelWithKeys(tool.id),
                  "aria-keyshortcuts": ariaKeyShortcuts(tool.id),
                  variant: "quiet" as const,
                  disabled: !state.enabled,
                  focusableWhenDisabled: true,
                  "data-hm-tool": tool.id,
                };
                return tool.isActive ? (
                  <ToggleButton
                    key={tool.id}
                    {...common}
                    pressed={state.active}
                    onPressedChange={() => run(tool.id)}
                  />
                ) : (
                  <IconButton key={tool.id} {...common} onClick={() => run(tool.id)} />
                );
              })}
            </ToolbarGroup>
          );
        })}
      </Toolbar>
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        hidden
        className="hm-audio-editor-picker"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // The same file can be chosen again.
          event.currentTarget.value = "";
          if (!file) return;
          // A failure is in the snapshot, which the stage shows.
          (purpose.current === "open" ? open(file) : insert(file)).catch(() => {});
        }}
      />
    </>
  );
}
