---
"@hussmartinez/audio-sdk": minor
---

The editor exports, through **`AudioExportDialog`**, which the toolbar's new Export button opens:

- **A summary first:** the length, sample rate and channels, any track a mute or a solo leaves out, and the metadata that will be written. Then the format, 16-bit (the default), 24-bit or 32-bit float WAV, each with the file's exact size.
- **While it runs,** a progress bar and Stop. **When it's done,** Download, which saves `<fileName>.wav`. The name comes from the new `fileName` prop, or else the recording's title, or else `recording`.
- **When the mix clipped,** the dialog says by how much, and one button lowers the master gain by that and exports again.
- **`onExport(blob, result)`** on `AudioEditor` and `AudioExportDialog` takes the file instead of the download, and the dialog closes. `result` has the mix's `peakDb` and its `clippedFrames`.
- **The editor's handle** gains `export(options)`, which exports without the dialog.
