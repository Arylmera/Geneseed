---
group: guides
order: 2
title: "Install from a clone"
kind: "concept"
section: "Install"
description: "Install from a git clone when npm is out of reach, or when you want to change the harness."
---
Clone the repository when npm is out of reach (for example, a corporate network with no registry access), or when you want to change the harness rather than just use it. A clone needs **git** as well as Node 22.3 or newer. git is what updates the clone.

Each OS has a one-step installer at the root of the clone. It checks for Node and git. If one is missing, it names what to install and where to get it, then stops. **It never installs anything itself.** When the checks pass, it runs the setup wizard and offers to open the web console.

```bash
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
./install                 # macOS, Linux, or a POSIX shell on Windows
```

- **macOS**: you can also double-click `install.command` in the Finder. It opens in Terminal.
- **Windows**: double-click `install.cmd` in Explorer, or run it from cmd or PowerShell. It needs no bash, WSL or PowerShell script.

```powershell
git clone https://github.com/Arylmera/Geneseed.git
cd Geneseed
.\install.cmd
```

Later, run the launcher in the clone: `./geneseed setup` (Windows: `.\geneseed.cmd setup`) re-runs the wizard, and bare `./geneseed` opens the web console. Both launchers need `node` on `PATH`. If it is not there (some version managers only patch interactive shells), set `GENESEED_NODE` to the absolute path of the Node binary.

From a clone, every `geneseed …` command on these pages is `./geneseed …` (Windows: `.\geneseed.cmd …`). To drop the `./`, see [Run geneseed from anywhere](run-anywhere.md).

---

**Next:** [Verify it works](verify.md) · [Install](install.md)
