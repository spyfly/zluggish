---
sidebar_position: 2
description: Set up a Linux client for Zluggish
---

# Linux

How to set up a Linux Zwift client to talk to Zluggish. These steps are for Zwift for Windows in Wine, Lutris, Bottles or Steam (Proton).

## Automatic install (recommended)

1. Install the official Zwift app.
2. Start the Zwift app and check if there are any updates. Don't sign in.
3. Close the Zwift app.
4. Sign in to the Zluggish web app and select **Apps** in the menu.
5. Download the setup shell script for Linux.

   ![Linux setup in three steps: download the setup script, run it and start Zwift, with the certificate fingerprints below](../../../media/screenshots/webapp-install-linux.png)

6. Open a terminal and run the downloaded script:

   ```sh
   sh ~/Downloads/zluggish-zwift-*.sh
   ```

   Enter your password when `sudo` asks.

7. Wait until the script finishes. If the Wine prefix is still running, stop it with `wineserver -k`.

You can now start the Zwift app and it should show the Zluggish launcher. Enjoy!

You might need to re-download the script and run it again if Zwift updates. Run it again if the administrator rotates the server certificate, too.

Here is what the script does:

- trusts the server certificate in the system trust store,
- adds the certificate to `data/cacert.pem` of each Zwift that it finds in a Wine, Lutris, Bottles or Steam prefix, and removes the old shared certificate there,
- points the Zwift host names at the server in `/etc/hosts`.

It saves the original files as `cacert.pem.zluggish-backup` and `/etc/hosts.zluggish-backup`.

## If the script cannot find Zwift

Run it again with the Zwift folder, for example:

```sh
sh ~/Downloads/zluggish-zwift-*.sh "$HOME/.wine/drive_c/Program Files (x86)/Zwift"
```

## Check the certificate

The **Install** page shows the thumbprint and the SHA-256 fingerprint of the certificate. The script stops if its certificate does not match its thumbprint.

To stop using Zluggish, see [Uninstall](../../maintenance/uninstall.md).
