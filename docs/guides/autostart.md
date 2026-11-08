---
group: guides
order: 27
title: "Start the web console at login"
kind: "concept"
section: "Keep it running"
description: "Keep the web console running from login."
---
The web console is the only long-running Geneseed process. `geneseed web start` launches it as a background process on `127.0.0.1:4747` and returns immediately. A login item that runs this command once, with `--no-browser`, leaves the console ready whenever you open [http://127.0.0.1:4747](http://127.0.0.1:4747).

```
geneseed web start --no-browser   # start in the background
geneseed web status               # is it running?
geneseed web stop                 # stop it (the login item stays)
geneseed web restart              # restart it, e.g. after an update
```

Only one console runs at a time. A second `start` does nothing, so logging in twice is harmless. Each machine and each user runs its own console on its own loopback address.

> **Always use `web start` in a login item, never bare `web`.** Bare `geneseed web` runs in the foreground and leaves no record of itself. `web stop`, `web restart` and `web status` then cannot see it: they report no live server while it keeps serving. A `restart` would then start a second console that cannot take the busy port.

## From the web console

Open **Settings** and find the **Start at login** row in **Server**. The row shows the file and its state:

| State | What the row offers |
| --- | --- |
| Off | **Turn on** writes the login item for this platform |
| On · written by Geneseed | **Remove** deletes it |
| On · points at another copy or Node | **Update** rewrites it for this copy |
| On · set up by hand | A link to this guide. Geneseed does not change or delete the file |

Each button asks first, and the question names the file. Geneseed writes only one file per platform:

- **Windows:** `geneseed-web.vbs` in your Startup folder.
- **macOS:** `~/Library/LaunchAgents/dev.geneseed.web.plist`. It loads at your next login. Geneseed does not run `launchctl`. To start the console now, run `launchctl load` on the file, or run `geneseed web start`.

The file runs the Node that runs the console, by absolute path, with this copy's `bin/geneseed-cli.mjs` and `web start --no-browser`. Its second line (the third line of a plist) is a `GENESEED_AUTOSTART` comment. Geneseed updates or removes a file only when that exact line is in that place, so a file you wrote yourself stays yours. If you upgrade Node or move the copy, the row shows **Update**. The confirm names the copy the file runs, and it warns you when that copy is an agent worktree (`.claude/worktrees`) or an npx cache: such a folder can be deleted, and the login item then fails. On Windows, Geneseed refuses a path with a `%` (the login script would expand it) or a character outside ASCII. Set those up by hand.

> **The page token does not stop a local program.** Each write needs the page's token, which keeps other web pages in your browser from turning this on. A program that runs as you can read the token from the console's record, `.geneseed-web.json` in the install folder it serves, and send the same request. It could also write the file itself, so this adds no new risk. The confirm only asks you; it does not protect anything.

If the write fails, the row shows the error from the system. A managed Windows PC can block the Startup folder or VBS scripts. Then use the scheduled task below, or ask your administrator.

Only **Settings** writes a login item. `geneseed migrate` and uninstall do not write or delete one.

## By hand

The examples below assume `geneseed` is on your `PATH` (see [Run geneseed from anywhere](run-anywhere.md)). Login items do not see your shell's `PATH`, so always use the absolute path to the launcher. For an npm install, `npm prefix -g` shows where npm keeps it.

### Windows

Press **Win+R**, type `shell:startup`, and create a file called `geneseed-web.vbs` in the folder that opens:

```vbs
' geneseed-web.vbs: start the Geneseed web console at login (hidden, no browser).
CreateObject("WScript.Shell").Run "cmd /c ""C:\Users\you\AppData\Local\Geneseed\bin\geneseed.cmd"" web start --no-browser", 0, False
```

Write out the full path, as shown. VBS does not expand `%LOCALAPPDATA%` inside a string. The script runs hidden, so no console window flashes at login. To disable it, delete the file.

If you would rather use a scheduled task:

```powershell
schtasks /Create /TN "Geneseed Web" /SC ONLOGON /TR "\"%LOCALAPPDATA%\Geneseed\bin\geneseed.cmd\" web start --no-browser" /RL LIMITED /F
schtasks /Delete /TN "Geneseed Web" /F   # to remove it
```

### macOS

Create a LaunchAgent at `~/Library/LaunchAgents/dev.geneseed.web.plist`. Set `RunAtLoad` and **no** `KeepAlive`. The launcher exits as soon as it has started the background process, which keeps running on its own.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>            <string>dev.geneseed.web</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/you/.local/bin/geneseed</string>
    <string>web</string>
    <string>start</string>
    <string>--no-browser</string>
  </array>
  <key>RunAtLoad</key>        <true/>
</dict>
</plist>
```

`/Users/you/.local/bin/geneseed` is where `./geneseed link` puts the launcher by default. Replace it with your own absolute path. Then load the agent, which also starts the console now:

```bash
launchctl load ~/Library/LaunchAgents/dev.geneseed.web.plist     # enable and start now
launchctl unload ~/Library/LaunchAgents/dev.geneseed.web.plist   # disable
```
