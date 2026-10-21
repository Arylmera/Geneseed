---
group: guides
order: 9
title: "Run geneseed from anywhere"
kind: "concept"
section: "Install"
description: "Put the geneseed command on your PATH from a clone."
---
**Installed from npm? You have nothing to do.** `npm install -g geneseed` already puts `geneseed`, `geneseed-build` and `geneseed-hook` on your `PATH`.

From a clone, you call the launcher inside the clone: `./geneseed` (Windows: `.\geneseed.cmd`). To type plain `geneseed` from any folder, link it. On macOS and Linux, `./install` does this for you when `geneseed` is not found yet.

## macOS and Linux

```
./geneseed link                    # a launcher in ~/.local/bin, no sudo
./geneseed link /usr/local/bin     # or another bin folder (may ask for sudo)
```

`link` writes a small shell launcher that runs this clone by its absolute path. If the target folder is not on your `PATH` (macOS zsh does not search `~/.local/bin`), it offers to add it to your shell's startup file: `~/.zshrc` for zsh, `~/.bashrc` for bash on Linux, `~/.bash_profile` for bash on macOS. It appends one marked block, never twice, and `geneseed unlink` removes it. Outside a terminal, or for another shell, it prints the line to add instead. Open a new terminal, then:

```
geneseed            # the web console (or the command list), from any folder
geneseed build      # and every other command
```

If you prefer a shell function, add one to your `~/.zshrc` or `~/.bashrc` from inside the clone instead:

```
echo 'geneseed() { "'"$PWD"'/geneseed" "$@"; }' >> ~/.zshrc
```

## Windows

```powershell
.\geneseed.cmd link
```

This writes a `geneseed.cmd` launcher into `%LOCALAPPDATA%\Geneseed\bin` and adds that folder to your user `PATH`. You need neither admin rights nor symlinks. Open a new terminal, then call `geneseed` from any folder.

## Undo it

```
geneseed unlink
```

`unlink` removes the launchers that `link` wrote. It leaves alone any `geneseed` it did not write itself. In the web console, **Settings** has the same link and unlink controls.
