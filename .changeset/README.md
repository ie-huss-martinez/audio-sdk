# Changesets

Each file here describes one user-facing change to a published package, and the version bump it needs. Add one with `pnpm changeset` in any pull request that changes a package's published source or `package.json`. See [CONTRIBUTING.md](../CONTRIBUTING.md#changesets) for how to write a good one.

When changesets reach `main`, the release workflow opens a "chore: version packages" pull request that applies them: it bumps versions, writes the changelogs and deletes these files. Merging that pull request publishes the packages ([ADR 0021](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0021-version-and-release-with-changesets.md)).
