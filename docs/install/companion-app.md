---
sidebar_position: 5
description: Publish Zwift Companion for Android from the Zluggish web app.
---

# Publish Zwift Companion

The server patches Companion to trust its own certificate and signs it as `com.zluggish.companion`. Riders can keep the Play Store app installed alongside it.

## Add the app to the server

1. As an administrator, open **Manage → Android apps → Companion**.
2. Select **Download and build** if offered. The server fetches the app from APKPure and patches it.
3. To upload instead, use **Upload Companion**. The server accepts an APK or a split bundle (`.apks`, `.xapk` or `.apkm`). It can also rebuild a [zoffline-companion release](https://github.com/fatsbrown/zoffline-companion/releases/latest) or replace the certificate in an existing Zluggish Companion APK.
4. After the build finishes, riders can [install Companion](clients/companion-android.md) from **Apps**.

If you replace an older build that used the official app ID, upload it again. Riders install the new app separately and sign in again.

## Build tools and backups

The server downloads and verifies APKEditor and, if needed, Java for the first rebuild. It can reuse Java 11 or later from `PATH`. An existing Zluggish APK only needs its certificate replaced. Keep the `tools/` directory mounted across container updates to reuse the tools. The example Compose file does this.

Save `storage/companion/signer.pem` separately. [Server backups](../maintenance/backup-and-restore.md) skip the Companion directory, including the signing key and APKs. If the server signs the app with a new key, riders must uninstall the previous copy before installing the new one.
