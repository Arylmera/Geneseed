---
group: guides
order: 9
title: "Run geneseed from anywhere"
kind: "concept"
---
**Installed from npm? You have nothing to do.** `npm install -g geneseed` already puts `geneseed`, `geneseed-build` and `geneseed-hook` on your `PATH`.

From a clone, you call the launcher inside the clone: `./geneseed` (Windows: `.\geneseed.cmd`). To type plain `geneseed` from any folder, link it.

## macOS and Linux

```
./geneseed link                    # a launcher in ~/.local/bin, no sudo
./geneseed link /usr/local/bin     # or another bin folder (may ask for sudo)
```

`link` writes a small shell launcher that runs this clone by its absolute path. It also tells you whether the target folder is on your `PATH`, and if it is not, the one line to add to your shell profile. Then:

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
