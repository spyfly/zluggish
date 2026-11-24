---
sidebar_position: 3
description: Set up a macOS client for Zluggish
---

# macOS

How to set up a macOS Zwift client to talk to Zluggish.

## Automatic install (recommended)

1. Install the official Zwift app.
2. Start the Zwift app and check if there are any updates. Don't sign in. This also creates its data folder.
3. Quit the Zwift app.
4. Sign in to the Zluggish web app and select **Apps** in the menu.
5. Download the setup shell script for macOS.

   ![macOS setup in three steps: download the setup script, run it in Terminal and start Zwift, with the certificate fingerprints below](../../../media/screenshots/webapp-install-macos.png)

6. Open Terminal and run the downloaded script:

   ```sh
   sh ~/Downloads/zluggish-zwift-*.sh
   ```

   Enter your password when `sudo` asks. Allow macOS to change certificate trust when it asks.

7. Wait until the script finishes.

You can now start the Zwift app and it should show the Zluggish launcher. Enjoy!

You might need to re-download the script and run it again if Zwift updates. Run it again if the administrator rotates the server certificate, too.

Here is what the script does:

- trusts the server certificate for TLS in the **System** keychain, and removes certificates that earlier setups of this server added and the old shared certificate,
- adds the certificate to `~/Library/Application Support/Zwift/data/cacert.pem`, and removes the old shared certificate there,
- points the Zwift host names at the server in `/etc/hosts`.

It saves the original files as `cacert.pem.zluggish-backup` and `/etc/hosts.zluggish-backup`.

## If the script cannot find Zwift

Run it again with the Zwift folder:

```sh
sh ~/Downloads/zluggish-zwift-*.sh "$HOME/Library/Application Support/Zwift"
```

Do not import the certificate with Keychain Access instead. Double-clicking the file, or **File → Import Items…**, can add it without any message and without trusting it.

## Check the certificate

The **Install** page shows the thumbprint and the SHA-256 fingerprint of the certificate. The script stops if its certificate does not match its thumbprint. In Keychain Access, the certificate is **\*.zwift.com** in the **System** keychain, and its SHA-1 fingerprint is the thumbprint.

To stop using Zluggish, see [Uninstall](../../maintenance/uninstall.md).
