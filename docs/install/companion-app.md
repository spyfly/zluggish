---
sidebar_position: 5
description: Use the Zwift Companion app with Zluggish on an Android device.
---

# Zwift Companion app

Zwift Companion connects only to servers it trusts. Zluggish makes a copy of the Android app that trusts your
server's certificate, and every rider downloads it from the web app under **Apps**.
The patched app uses the Zluggish launcher icon and the Android app ID `com.zluggish.companion`, so you can
install it alongside the Play Store version.

The administrator downloads or uploads Zwift Companion through the web app, and the server patches that copy
for its own riders. For phone setup, see [Companion (Android)](clients/companion-android.md) or
[Companion (iPhone and iPad)](clients/companion-ios.md).

## Add the app to the server

Do this once as the administrator, and again for a new Companion version.

1. The server must use its own certificate. If **Manage → Server** shows the shared Zwift certificate, generate a
   server certificate first.
2. Open **Manage → Android apps → Companion**. If the page offers **Download and build**, select it to let the
   server download the app from APKPure and patch it. Otherwise, get a Companion APK to upload:
   - An app already patched for zoffline, such as a
     [zoffline-companion release](https://github.com/fatsbrown/zoffline-companion/releases/latest). The server rebuilds it with the Java tools
     so that it installs alongside the official app.
   - The app from the Play Store, as an `.apk`, or as an `.apks`, `.xapk` or `.apkm` bundle of split APKs. The server
     rebuilds its resources, which needs the Java tools. See below.
   - A Zluggish Companion APK that already uses `com.zluggish.companion`. The server swaps in its own certificate
     in seconds without the Java tools.
3. If uploading, drop the file on **Upload Companion**. Keep the page open until the upload finishes; patching then
   continues in the background. The server rebuilds Play Store and zoffline copies with the Java tools.

The server signs the app with its own key, kept in `storage/companion/signer.pem`. Android installs an update only
when it carries the same signature, so keep a separate copy of this key: with a new key, every rider uninstalls once.
[Server backups](../maintenance/backup-and-restore.md) leave out the entire `storage/companion/` folder, including
the app, saved upload and signing key.

When you rotate the server certificate, the server updates the app on its own. Riders then install the new download
over the old app.

If your server previously published Companion under the official app ID, upload it again to make the new build
available. Android installs the new build separately, so riders sign in again.

### Java tools

Play Store and zoffline copies need them; an existing Zluggish build does not. When you upload such an app, the server automatically installs
the tools and continues patching. The Companion management page shows the download size. If installation fails,
you can retry the download or discard the upload. The server downloads:

- An [Eclipse Temurin](https://adoptium.net) Java 21 runtime, about 50 MB. If the server already has Java 11 or later
  on its `PATH`, it uses that instead.
- [APKEditor](https://github.com/REAndroid/APKEditor), about 8 MB. It merges split APKs and rebuilds the resources.

Each file is checked against a checksum pinned in Zluggish. The tools go to a `tools` folder beside the storage
folder, never into storage or backups.

In a container, mount the `tools` folder to keep the tools across updates, as the example `docker-compose.yml`
does. Otherwise the server downloads them again after an update.

## Install the app on a phone

Follow [Companion (Android)](clients/companion-android.md) to download the published app, point it at Zluggish
and sign in. [iPhone and iPad](clients/companion-ios.md) are not supported.
