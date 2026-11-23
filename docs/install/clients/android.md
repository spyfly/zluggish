---
sidebar_position: 4
description: Set up a non-rooted Android device to ride on your Zluggish server.
---

# Android

This procedure is for a device that is not rooted. For a rooted device, see [Android (rooted)](android-rooted.md). In the web app, **Set up Android** on the **Apps** page shows the same steps with the address of the server filled in.

Zwift from Google Play stores its certificate bundle in an expansion file. Patch your copy of that file with your Zluggish server’s certificate, then use Virtual Hosts or DNS to send Zwift to the server.

## Publish Zwift for Android

An administrator opens **Apps → Zwift → Android → Publish Zwift for Android** and uploads an APKMirror `.apkm` labeled **BUNDLE 1 OBB**. The server patches the expansion file and publishes an `.xapk` containing the original APKs and patched expansion. Upload the original APKM again if you published it before install bundles were available or if the server certificate changes.

APKM uploads support up to 10 GB. The web uploader sends 16 MiB chunks so it can work through Cloudflare Tunnel. Keep the admin page open during the transfer so it can retry interrupted chunks. Patching and packaging continue in the background after all chunks arrive.

## Install on the phone

1. On the Android device, install [APKMirror Installer](https://play.google.com/store/apps/details?id=com.apkmirror.helper.prod).
2. Sign in to Zluggish and open **Apps → Zwift → Android**. Download the Zwift install bundle.
3. Open the downloaded `.xapk` in APKMirror Installer and follow the Android installation prompts.
4. Finish the server setup below before opening Zwift.

## Install manually with ADB

Administrators can also upload a standalone `main.*.com.zwift.zwiftgame.obb` from a clean Google Play installation. Open **Install the expansion manually with ADB** to download the matching patched OBB and follow the copy instructions. Clear Zwift’s app storage before copying the file if Zwift has already unpacked the original expansion.

## Send Zwift to Zluggish

1. Install `app-Github-release.apk` from the [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
2. Copy the provided host entries from **Apps → Zwift → Android** into a file named `hosts.txt` on the device.
3. In the Android settings, turn off **Private DNS**.
4. Open Virtual Hosts and select `hosts.txt`.

To use Zluggish DNS, set `dns.enabled` to `true` in `zluggish.config.ts` and set the Wi-Fi connection’s primary DNS server to the IP address of the Zluggish server. See [Configuration](../../reference/configuration.md). You can also set the host records on a router that supports local DNS overrides.

## Ride

1. Make sure that the Virtual Hosts button is on.
2. Ask an administrator to make your user in the [web app](../../usage/web-app.md), under **Manage → Users**. Your user must have a password.
3. In Zwift, sign in with your username and password.
