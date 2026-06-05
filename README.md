# cdwt

Interactive `git worktree` switcher for `zsh`. Pick an existing worktree, jump
back to the default branch worktree, create a new worktree from the default
branch, check out a GitHub PR into a worktree, or delete one — and `cd` into
the result.

Written in TypeScript, distributed as an `npx`-installable CLI plus a small
`zsh` function that performs the `cd`.

## Requirements

- Node.js 20+
- `git`
- `zsh`
- `fzf` recommended — without it the selector falls back to a numbered prompt
- `gh` optional — enables the `github pr` section

## Install

### From npm

Try it once:

```sh
npx @soprog_/cdwt --default-branch
```

Install for daily use:

```sh
npm i -g @soprog_/cdwt        # or: pnpm add -g @soprog_/cdwt
cdwt install                  # writes shell function + sources it from ~/.zshrc
exec zsh -l
```

`npm i -g` only installs the `cdwt` executable. Run `cdwt install` once so
`zsh` loads the shell function that performs the actual `cd`.

### From source

```sh
git clone https://github.com/souta0104/cdworktree.git
cd cdworktree
pnpm install
pnpm build
pnpm link --global
cdwt install
exec zsh -l
```

`cdwt install` writes `~/.local/share/cdwt/cdwt.zsh` and adds
`source "$HOME/.local/share/cdwt/cdwt.zsh"` to `~/.zshrc` (skipped if already
present). The shell function is required because a child process can't change
the parent shell's directory: `cdwt` prints the destination path on stdout
and the function `cd`s into it.

## Usage

```sh
cdwt
```

Opens a single picker with rows tagged by section (in this order):

| Glyph + Tag      | Action on `enter`                                           |
| ---------------- | ----------------------------------------------------------- |
| `★ [main]`       | `cd` into the main worktree                                 |
| `● [worktree]`   | `cd` into an existing linked worktree                       |
| `◆ [PR]`         | `cd` into the PR's worktree (creates a detached one if new) |
| `○ [branch]`     | runs `git worktree add` for that local branch and `cd`s in  |

Filled glyphs (`★ ●`) mark rows whose worktree already exists on disk; open
glyphs (`○ ◆`) mark rows that will create a new worktree on `enter`. Each
section also has its own color so worktrees and branches are visually distinct.

`/new <branch>` creates a new worktree from the default branch; `ctrl-d` on
a `[worktree]` row deletes that worktree (with a confirmation prompt).

```sh
cdwt --default-branch         # skip the picker, jump to the main worktree
cdwt -h                       # show help (bypasses the shell wrapper)
```

`--default-branch` jumps to the main worktree (the one that holds the
non-bare `.git` directory), not literally to a worktree of `origin/HEAD`.
In a typical setup these are the same; if you've checked out a different
branch in the main worktree, that's what you'll land on.

### New worktree paths

`new worktree` and `local branch` create the worktree at:

```
<repo-parent>/<repo-name>-<branch-slug>
```

`<branch-slug>` replaces `/`, spaces, and any non-`[A-Za-z0-9._-]` character
with `-`, then trims leading/trailing dashes (e.g. `feature/awesome` →
`repo-feature-awesome`).

`github pr` for a branch without a local worktree creates:

```
<repo-parent>/<repo-name>-pr-<pr-number>
```

…then runs `gh pr checkout <pr-number>` inside it.

### Selector keys

With `fzf`:

- `enter` — `cd` into the highlighted entry
- `esc` — cancel
- `tab` / `shift-tab` — cycle the filter (all / worktree / branch / pr)
- `ctrl-d` — delete the highlighted worktree (confirmation prompt)
- `?` — show the help overlay (includes a row legend)
- `/` — slash commands (`/new <branch>`, `/main`, `/pr`, `/refresh`, `/help`)

Without `fzf`: numbered prompt; type a number to jump, `d <number>` to
delete that entry, or one of the slash commands above.

## Configuration

`.cdwt/settings.json` controls which Git-ignored files get copied into newly
created worktrees:

```json
{
  "copyIgnored": {
    "paths": [".claude/settings.local.json"],
    "patterns": [".claude/**", "CLAUDE.md", "*.local.json"]
  }
}
```

- `paths` — repo-relative file or directory paths copied verbatim
- `patterns` — glob patterns matched against repo-relative paths
  - a pattern containing `/` matches the whole path
  - a pattern without `/` matches any file or directory of that name

Only files Git considers ignored are copied. Patterns and paths that escape
the worktree (`..`, absolute, …) are rejected.

### Config resolution order (weak → strong)

Later files override matching keys; missing keys leave earlier values intact.
An explicit empty array clears the inherited value.

1. `$HOME/.cdwt/settings.json`
2. `.cdwt/settings.json` walking from `/` down to the cwd (or to the main
   worktree if cwd is outside it)

Set `CDWT_CONFIG=/path/to/settings.json` or pass `--config <file>` to read
only that file.

## Development

```sh
pnpm install
pnpm test            # vitest
pnpm typecheck       # tsc --noEmit
pnpm lint            # eslint
pnpm format          # prettier --write .
pnpm build           # tsup → dist/cli.js
pnpm dev -- --default-branch
```

Layout:

```
src/
  cli.ts                   commander entry
  commands/                select / install / actions (confirm + git ops)
  core/                    pure functions (paths, config merge, sections, ...)
  io/                      git, gh, fs, repo context
  ui/                      fzf, prompts, selector flow
shell/cdwt.zsh             zsh wrapper that cd's into stdout
tests/                     vitest (pure + integration against a temp git repo)
```

## Uninstall

```sh
npm rm -g cdwt                # or: pnpm remove -g cdwt
rm -f ~/.local/share/cdwt/cdwt.zsh
```

Then remove this line from `~/.zshrc`:

```sh
source "$HOME/.local/share/cdwt/cdwt.zsh"
```
