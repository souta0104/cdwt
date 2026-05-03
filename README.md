# cdwt

Interactive `git worktree` switcher for `zsh`.

`cdwt` lets you pick an existing worktree, jump back to the default branch worktree, or create a new linked worktree and `cd` into it.

## Requirements

- `git`
- `zsh`
- `fzf` recommended
- `jq` when using `.cdwt/settings.json`
- `gh` optional for GitHub PR worktree creation

If `fzf` is unavailable, `cdwt` falls back to a numbered prompt.

## Install

```sh
git clone https://github.com/souta0104/cdwt.git
cd cdwt
./install.sh
```

The installer:

- copies `cdwt-select` to `~/.local/bin`
- copies the `zsh` wrapper to `~/.local/share/cdwt/cdwt.zsh`
- adds `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc` if missing
- adds `source "$HOME/.local/share/cdwt/cdwt.zsh"` to `~/.zshrc` if missing

Then reload your shell:

```sh
exec zsh -l
```

Or:

```sh
source ~/.zshrc
```

## Usage

```sh
cdwt
```

This opens a selector with:

- `root`
- `worktree`
- `new worktree`
- `delete worktree`
- `github pr` when `gh` is available
- `local branch`

Selecting `new worktree` asks for a new branch name and creates it from the default branch into:

```text
<repo-parent>/<repo-name>-<branch-name>
```

Selecting a branch without a worktree asks for confirmation, then runs `git worktree add` into:

```text
<repo-parent>/<repo-name>-<branch-name>
```

Selecting `delete worktree` asks for confirmation, removes the selected worktree, and returns to the default branch worktree.

Selecting a GitHub PR with no existing worktree asks for confirmation, creates a detached worktree, and runs:

```sh
gh pr checkout <pr-number>
```

inside that worktree.

If the PR's head branch already has a local worktree, the `github pr` section shows that existing path and selecting it jumps there directly.

Ignored files can be copied into new worktrees with `.cdwt/settings.json`:

```json
{
  "copyIgnored": {
    "paths": [
      ".claude/settings.local.json"
    ],
    "patterns": [
      ".claude/**",
      ".codex/skills/**",
      "CLAUDE.md",
      "AGENTS.md",
      "*.local.json"
    ]
  }
}
```

`cdwt` reads config files from weak to strong. The nearest file wins when the same key is set.

- `$HOME/.cdwt/settings.json`
- `.cdwt/settings.json` in parent directories
- `.cdwt/settings.json` nearest to the directory where `cdwt` was run

Set `CDWT_CONFIG=/path/to/settings.json` to read only that file.

`copyIgnored.paths` accepts repo-relative paths. `copyIgnored.patterns` accepts glob patterns. A pattern with `/` matches the repo-relative path. A pattern without `/` matches any file name or directory name.

Only files ignored by Git are copied.

In the item selector:

- `esc` returns to the section selector
- `tab` moves to the next section
- `shift-tab` moves to the previous section

In the section selector, typing opens a cross-section search view showing matches from all sections.

You can jump directly to the default branch worktree with:

```sh
cdwt --default-branch
```

## Uninstall

Remove these files:

```sh
rm -f ~/.local/bin/cdwt-select
rm -f ~/.local/share/cdwt/cdwt.zsh
```

Then remove this line from `~/.zshrc`:

```sh
source "$HOME/.local/share/cdwt/cdwt.zsh"
```
