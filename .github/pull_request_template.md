<!--
The title must be a Conventional Commit with a lowercase subject, such as
"fix: keep the playhead in place after undo". It becomes the commit title
on main. See CONTRIBUTING.md for how pull requests are merged.
-->

## What

<!-- What changed, in a few bullet points. -->

## Why

<!-- The problem this solves, with links to issues or ADRs. -->

## How it was tested

<!-- Include the result of `pnpm verify`, and anything you checked by hand. -->

## Checklist

- [ ] `pnpm verify` passes locally, and its result is above.
- [ ] Tests cover the change, next to the code.
- [ ] Exported APIs are typed and have TSDoc, and the API report is updated where the package has one.
- [ ] New dependencies are justified above.
- [ ] READMEs and docs are accurate.
- [ ] UI works with the keyboard, passes axe and has visible focus, where the change has UI.
- [ ] File data is parsed only in workers, new resources a file controls have a limit, and no network request is added.
- [ ] New or changed parsers have truncation, garbage and fuzz tests; codec upgrades ran the contract tests and the end-to-end fixtures.
- [ ] A changeset is added, if the change alters what the package publishes.
- [ ] Significant decisions are recorded as an ADR in `docs/adr`.
