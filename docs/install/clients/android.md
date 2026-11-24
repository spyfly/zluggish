---
sidebar_position: 4
description: Set up an Android device to ride on your Zluggish server.
---

# Android

In the web app, **Set up Android** on the **Apps** page shows the same steps with the address of the server filled in. No root access is needed.

Zwift from Google Play keeps the servers it trusts in its expansion file. The administrator uploads Zwift once, and the server publishes **Zwift for Zluggish**: a copy that trusts your server and installs next to Zwift from Google Play. Riders download it from the web app, then send it to the server with Virtual Hosts or DNS.

## Publish Zwift for Android

An administrator does this once per Zwift version.

1. Open [Zwift on APKMirror](https://www.apkmirror.com/apk/zwift-inc/zwift/), select the newest version and download the variant marked **BUNDLE 1 OBB**: an `.apkm` file of about 4 GB.
2. In the [web app](../../usage/web-app.md), open **Manage → Android apps → Zwift** and drop the file on the upload area.
3. Keep the page open until the upload finishes. It shows the progress, speed and time left.
4. The server then builds the app in the background. The page shows each step; you can leave it.

Building takes about 10 GB of free space on the storage disk; the page warns when there is less. The first build downloads Java and APKEditor, about 60 MB, which the Companion app patcher shares. Uploads up to 10 GB are accepted, sent in 16 MiB pieces so that they pass proxies such as Cloudflare Tunnel.

The server keeps the last upload. When you rotate the server certificate, it builds the app again on its own; **Build again** does the same by hand. The upload and the built app are left out of backups.

## Install on the phone

1. On the Android device, sign in to the web app and open **Apps → Set up Android**.
2. Select **Download Zwift**. Use Wi-Fi: the app is about 4 GB.
3. Open the downloaded file. Allow your browser to install apps, then select **Install**. If Google Play Protect warns about an unknown app, select **Install anyway**.

## Send Zwift to Zluggish

1. Install `app-Github-release.apk` from the [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
2. Copy the provided host entries from **Apps → Zwift → Android** into a file named `hosts.txt` on the device.
3. In the Android settings, turn off **Private DNS**.
4. Open Virtual Hosts and select `hosts.txt`.

To use Zluggish DNS, set `dns.enabled` to `true` in `zluggish.config.ts` and set the Wi-Fi connection’s primary DNS server to the IP address of the Zluggish server. See [Configuration](../../reference/configuration.md). You can also set the host records on a router that supports local DNS overrides.

## Ride

1. Make sure that the Virtual Hosts button is on.
2. Ask an administrator to make your user in the [web app](../../usage/web-app.md), under **Manage → Users**. Your user must have a password.
3. Open **Zwift for Zluggish** and sign in with your username and password. The first start unpacks the game files, which takes a few minutes.

Turn Virtual Hosts off before you open Zwift from Google Play.
