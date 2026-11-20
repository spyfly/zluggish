---
sidebar_position: 5
description: Use the Zwift Companion app with Zluggish on an Android device.
---

# Zwift Companion app

Zwift Companion connects only to servers it trusts. Zluggish makes a copy of the Android app that trusts your
server's certificate, and every rider downloads it from the web app under **Companion**.

Zluggish does not distribute the app. The administrator uploads Zwift Companion, and the server patches that copy
for its own riders.

:::info

iPhone and iPad are not supported. iOS runs only apps that Apple signed, and App Store apps are encrypted for each
Apple ID, so Companion cannot be changed to trust another server.

:::

## Add the app to the server

Do this once as the administrator, and again for a new Companion version.

1. The server must use its own certificate. If **Manage → Server** shows the shared Zwift certificate, generate a
   server certificate first.
2. Get the Companion APK. Either of these works:
   - An app already patched for zoffline, such as a
     [zoffline-companion release](https://github.com/fatsbrown/zoffline-companion/releases/latest). The server only
     swaps in its own certificate. This takes seconds and needs nothing else.
   - The app from the Play Store, as an `.apk`, or as an `.apks`, `.xapk` or `.apkm` bundle of split APKs. The server
     rebuilds its resources, which needs the Java tools. See below.
3. In the web app, open **Companion** and drop the file on **Upload Zwift Companion**.

The server signs the app with its own key, kept in `storage/companion/signer.pem`. Android installs an update only
when it carries the same signature, so keep backups of storage: with a new key, every rider uninstalls once. Backups
leave out the patched app itself, which is about 180 MB and can be patched again.

When you rotate the server certificate, the server updates the app on its own. Riders then install the new download
over the old app.

### Java tools

Only an app straight from the Play Store needs them. Under **Companion → Java tools**, select **Download Java
tools**. The server downloads:

- An [Eclipse Temurin](https://adoptium.net) Java 21 runtime, about 50 MB. If the server already has Java 11 or later
  on its `PATH`, it uses that instead.
- [APKEditor](https://github.com/REAndroid/APKEditor), about 8 MB. It merges split APKs and rebuilds the resources.

Each file is checked against a checksum pinned in Zluggish. The tools go to a `tools` folder beside the storage
folder, never into storage or backups. **Remove Java tools** deletes them again.

In a container, mount the `tools` folder to keep the tools across updates, as the example `docker-compose.yml`
does. Otherwise the server downloads them again after an update.

## Install the app on a phone

The web app walks every rider through these steps under **Companion → Android**:

1. Uninstall Zwift Companion if it came from the Play Store or another site. Android does not update an app with one
   signed by a different key.
2. Download the app from the web app on the phone, open it and install it.
3. Download and install `app-Github-release.apk` from the
   [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
4. Make a file with the name `hosts.txt` on the device. Replace `<server-ip>` with the IP address of the Zluggish
   server:

   ```text
   <server-ip> us-or-rly101.zwift.com
   <server-ip> secure.zwift.com
   ```

5. In the Android settings, turn off **Private DNS**.
6. Open Virtual Hosts and select `hosts.txt`.

:::warning

Do not add `cdn.zwift.com` to `hosts.txt`. Companion downloads images from the official server.

:::

Instead of Virtual Hosts, you can set `dns.enabled` to `true` in `zluggish.config.ts`. Then set **DNS 1** of the
phone's Wi-Fi connection to the IP address of the Zluggish server. If your router can change DNS records, you can also
set the records on the router.
