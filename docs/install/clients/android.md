---
sidebar_position: 4
description: Set up an Android client for Zluggish
---

# Android

How to set up an Android Zwift client to talk to Zluggish. No root access is needed.

Use **Zwift for Zluggish** from your server. It trusts the server certificate and installs alongside the official Zwift app from Google Play.

## Install on the phone

1. On the Android device, sign in to the Zluggish web app and select **Apps** in the menu.
2. Select **Set up Android** under **Zwift**.
3. Select **Download Zwift**. Use Wi-Fi: the app is about 4 GB.
4. Open the downloaded file. Allow your browser to install apps, then select **Install**. If Google Play Protect warns about an unknown app, select **Install anyway**.

If no download is available, ask the administrator to [publish Zwift for Android](#publish-zwift-for-android) first.

## Point Zwift at Zluggish

1. Install `app-Github-release.apk` from the [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
2. Copy the provided host entries from **Apps → Zwift → Android** into a file named `hosts.txt` on the device.
3. In the Android settings, turn off **Private DNS**.
4. Open Virtual Hosts and select `hosts.txt`.

To use Zluggish DNS, set `dns.enabled` to `true` in `zluggish.config.ts` and set the Wi-Fi connection’s primary DNS server to the IP address of the Zluggish server. See [Configuration](../../reference/configuration.md). You can also set the host records on a router that supports local DNS overrides.

## Start Zwift

1. Make sure that the Virtual Hosts button is on.
2. Ask an administrator to make your user in the [web app](../../usage/web-app.md), under **Manage → Users**. Your user must have a password.
3. Open **Zwift for Zluggish** and sign in with your username and password. The first start unpacks the game files, which takes a few minutes.

You can now ride on Zluggish. Enjoy!

Turn Virtual Hosts off before you open Zwift from Google Play.

## Update the app

When the administrator publishes a new version or rotates the server certificate, return to the Android setup page and install the new download over the existing app.

## Publish Zwift for Android

An administrator does this once per Zwift version.

1. Open [Zwift on APKMirror](https://www.apkmirror.com/apk/zwift-inc/zwift/), select the newest version and download the variant marked **BUNDLE 1 OBB**: an `.apkm` file of about 4 GB.
2. In the [web app](../../usage/web-app.md), open **Manage → Android apps → Zwift** and drop the file on the upload area.
3. Keep the page open until the upload finishes. It shows the progress, speed and time left.
4. The server then builds the app in the background. The page shows each step; you can leave it.

Building takes about 10 GB of free space on the storage disk; the page warns when there is less. The first build downloads Java and APKEditor, about 60 MB, which the Companion app patcher shares. Uploads up to 10 GB are accepted, sent in 16 MiB pieces so that they pass proxies such as Cloudflare Tunnel.

The server keeps the last upload. When you rotate the server certificate, it builds the app again on its own; **Build again** does the same by hand. The upload and the built app are left out of backups.
