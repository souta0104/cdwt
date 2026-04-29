# cdwt

Interactive `git worktree` switcher for `zsh`.

`cdwt` lets you pick an existing worktree, jump back to the main worktree, or create a new linked worktree for an existing local branch and `cd` into it.

## Requirements

- `git`
- `zsh`
- `fzf` recommended
- `gh` optional for GitHub PR worktree creation

If `fzf` is unavailable, `cdwt` falls back to a numbered prompt.

## Install

```sh
git clone <repo-url>
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
- `github pr` when `gh` is available
- `local branch`

Selecting a branch without a worktree asks for confirmation, then runs `git worktree add` into:

```text
<repo-parent>/<repo-name>-<branch-name>
```

Selecting a GitHub PR asks for confirmation, creates a detached worktree, and runs:

```sh
gh pr checkout <pr-number>
```

inside that worktree.

In the item selector:

- `esc` returns to the section selector
- `tab` moves to the next section
- `shift-tab` moves to the previous section

You can jump directly to the main worktree with:

```sh
cdwt --main
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
