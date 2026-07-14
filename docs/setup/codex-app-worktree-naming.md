# Codex App Worktree Naming

MangoRTS Codex app workers use a human-readable Git branch as their canonical identity:

```text
codex/<descriptive-english-words><7 digits>
```

For example:

```text
codex/fix-worktree-names0000123
```

The descriptive portion contains only English letters and hyphen-separated words. It must not contain or begin with a GUID, UUID, Codex thread ID, or other opaque identifier. The collision-safe seven-digit suffix is the only numeric portion and is always the final seven characters.

## Launcher contract

Every launcher-created worker prompt must include a dedicated purpose line:

```text
MANGORTS_WORKTREE_PURPOSE: fix worktree names
```

Keep this value short, descriptive, and English-only. The naming hook uses it as the preferred source for the branch slug instead of attempting to summarize the complete task prompt.

## Committed source of truth

These committed project files own the behavior:

- `scripts/codex/mango_worktree_naming_common.ps1` contains the shared purpose normalization and collision-safe seven-digit allocation logic.
- `scripts/codex/mango_app_worktree_suffix.ps1` is the Codex `UserPromptSubmit` hook entry point.
- `scripts/install_codex_app_worktree_hook.ps1` installs or updates the hook in the current user's Codex configuration.

The copy under the user's `.codex/hooks` directory is installed output, not the implementation source. Make changes in the committed project files, verify them there, and then rerun the installer.

From the MangoRTSDev repository root, install or update the hook with:

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\install_codex_app_worktree_hook.ps1
```

Restart the Codex app after installation so newly created tasks load the updated hook files. Codex records trust against the hook definition's current hash; if the app reports the registration as new or changed, review and approve it through the app's hook trust flow before creating another worker.

Verify that the installed scripts and hook registration still match committed source with:

```powershell
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\scripts\install_codex_app_worktree_hook.ps1 -Check
```

## Branch identity versus checkout directory

The Codex app physically owns its managed checkout location, typically beneath:

```text
%USERPROFILE%\.codex\worktrees\<opaque-id>\MangoRTSDev
```

That opaque directory leaf is an app implementation detail and is not project-controlled. Do not rename or move it. The project-controlled, user-visible identity is the Git branch, which must follow the suffix-last convention above.

After a worker starts, verify its canonical identity from inside the checkout:

```powershell
git branch --show-current
```

The result should have the form `codex/fix-worktree-names0000123`, with no GUID or UUID prefix.
