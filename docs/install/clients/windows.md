---
sidebar_position: 1
description: Connect Zwift for Windows to Zluggish.
---

# Windows

1. Install Zwift. Open it once to finish any updates, then exit it from the system tray before signing in.
2. In the [web app](../../usage/web-app.md), open **Apps → Zwift → Windows**. Use **Other systems** if Windows is hidden.
3. Select **Download setup script**.
4. Open the downloaded `.bat` file and allow it to run as an administrator. If SmartScreen blocks it, select **More info → Run anyway**.
5. Wait for **Done**, then open Zwift and sign in through the Zluggish launcher.

The script trusts the server certificate in the Local Computer root store and adds it to `data\cacert.pem` in the Zwift folder. It also updates `C:\Windows\System32\drivers\etc\hosts` unless you turn off **Patch hosts file** under **Advanced settings**. Before editing a file for the first time, the script saves a copy with the `.zluggish-backup` suffix.

## Manual setup

1. Open **Apps → Zwift → Manual setup** and download the `.cer` and `.crt` files.
2. Open an administrator Command Prompt. Import the certificate using the filename you downloaded.

   ```bat
   certutil.exe -addstore Root zluggish-zwift-XXXXXXXX.cer
   ```

3. Append the contents of the `.crt` file to `data\cacert.pem` in the Zwift installation directory.
4. With administrator rights, add the hosts line from **Manual setup** to `C:\Windows\System32\drivers\etc\hosts`. Use the server's IP address, or `127.0.0.1` if Zwift and Zluggish run on the same computer.

Run setup again when the [server certificate changes](../certificate.md) or if a [Zwift update](../../troubleshooting/client-updates.md) overwrites the client files. See [Uninstall](../../maintenance/uninstall.md) to switch back to the official service.
