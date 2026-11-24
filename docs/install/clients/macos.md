---
sidebar_position: 3
description: Connect Zwift for macOS to Zluggish.
---

# macOS

1. Install Zwift. Open it once to finish any updates and create its data folder, then quit before signing in.
2. In the [web app](../../usage/web-app.md), open **Apps → Zwift → macOS**. Use **Other systems** if macOS is hidden.
3. Select **Download setup script**.
4. In Terminal, run the command shown on the setup page. Enter your password when `sudo` prompts you.
5. Open Zwift and sign in through the Zluggish launcher.

The script trusts the server certificate in the **System** keychain and adds it to `~/Library/Application Support/Zwift/data/cacert.pem`. It updates `/etc/hosts` unless you turn off **Patch hosts file** under **Advanced settings**. Before editing a file for the first time, the script saves a copy with the `.zluggish-backup` suffix.

## If the script cannot find Zwift

Pass the Zwift data folder to the script. Replace the sample filename with the name you downloaded:

```sh
sh ~/Downloads/zluggish-zwift-XXXXXXXX.sh "$HOME/Library/Application Support/Zwift"
```

Run setup again when the [server certificate changes](../certificate.md) or if a [Zwift update](../../troubleshooting/client-updates.md) overwrites the client files. See [Uninstall](../../maintenance/uninstall.md) to switch back to the official service.
