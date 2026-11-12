# Security policy

`@hussmartinez/audio-sdk` opens audio files from anywhere: recordings, downloads, user uploads. Its promise is that those files are processed on the user's device and never leave it. A vulnerability here can break that promise inside every application that embeds it, so reports are among the most valuable this project can receive. Thank you for taking the time to report one privately.

## Reporting a vulnerability

**Please don't open a public issue, pull request or discussion.**

Report it through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go directly to [the advisory form](https://github.com/ie-huss-martinez/audio-sdk/security/advisories/new). Only the maintainer can see the report.

Please include:

- the affected version, or the commit;
- what an attacker can do, and under which conditions;
- steps to reproduce it, or a proof of concept. If it needs a crafted audio file, attach it to the private report. Never attach a real recording that contains personal or confidential data, such as voices or conversations.

## What to expect

- **Acknowledgement** within 7 days.
- **Updates** at least every 14 days until the issue is resolved.
- **A fix and an advisory.** Once a fix is released, a GitHub Security Advisory describes the issue, with a CVE where it applies. You're credited in the advisory unless you'd rather not be.
- **Coordinated disclosure.** Please keep the issue private until the advisory is published, or for 90 days after your report, whichever comes first. If a fix needs longer, we'll agree on a date with you.

## Supported versions

The package is pre-1.0. Security fixes go into the latest release only. No version has been published yet.

## Scope

In scope is everything in this repository: `@hussmartinez/audio-sdk`, its workers and its own parsers and encoders, the workflows that verify and release it, and the published package. Examples:

- an audio file that runs script in the host page or a worker, or makes the SDK insert file-derived text, such as a tag or a file name, as HTML;
- an audio file that freezes or crashes the page, hangs a header reader, or exhausts memory despite the file policy's limits, for example by declaring a small size and decoding to gigabytes; or one that the SDK parses outside a worker;
- any network request the SDK makes, including for workers or codecs;
- file names, audio, tags or metadata reaching the host's `onEvent`, or anything else that leaks a recording's data;
- an exported file that keeps audio the user removed, such as a trimmed or deleted range, or metadata the user cleared;
- styles from the standalone script that change the host page outside the editor;
- anything that requires a weaker Content Security Policy than documented, such as `unsafe-eval`;
- weaknesses in the build, release or publishing workflows, such as unpinned actions, excessive permissions, or a bundled dependency that doesn't match its pinned version.

The SDK reads file headers, parses uncompressed formats and encodes exports with its own code, and it decodes compressed formats with the browser's built-in decoders. **A known vulnerability in any third-party code that the SDK bundles is in scope** when the SDK's latest release still ships the affected version, because applications can only get the fix from us.

Out of scope:

- vulnerabilities in a browser's own audio decoders. Report those to the browser's vendor; tell us too if the SDK could avoid passing such files to the decoder, for example through a limit;
- issues that need an already compromised device, browser or build environment;
- a file that is merely slow within the configured limits, or that a browser can't decode. Report those as public issues;
- accessibility defects. They matter just as much, but report them as a public issue so they can be fixed in the open.

Vulnerabilities in the shared runtime or the design system go to their repositories' security policies: [sdk-core's](https://github.com/ie-huss-martinez/sdk-core/security/policy) and [ui's](https://github.com/ie-huss-martinez/ui/security/policy).
