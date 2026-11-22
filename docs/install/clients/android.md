---
sidebar_position: 4
description: Set up a non-rooted Android device to ride on your Zluggish server.
---

# Android

This procedure is for a device that is not rooted. For a rooted device, see [Android (rooted)](android-rooted.md). In the web app, **Set up Android** on the **Apps** page shows the same steps with the address of the server filled in.

Zwift from Google Play stores its certificate bundle in an expansion file. Patch your copy of that file with your Zluggish server’s certificate, then use Virtual Hosts or DNS to send Zwift to the server.

## Publish the expansion file

An administrator opens **Apps → Zwift → Android** and expands **Publish a Zwift expansion file**. Upload the matching APKMirror `.apkm` labeled **BUNDLE 1 OBB**, or follow the ADB instructions to copy and upload `main.*.com.zwift.zwiftgame.obb` from a clean Google Play install. The server patches and publishes the file for riders with that version. Publish a fresh copy when the server certificate changes.

## Set up the device

1. Install Zwift from Google Play and leave it closed.
2. Enable USB debugging and connect your Android device to a computer with ADB.
3. Sign in to the Zluggish web app on your computer and open **Apps → Zwift → Android**. Use the ADB command there to check the expansion filename, then download the matching patched file.
4. If you already started Zwift, clear its app storage in Android settings. Keep the downloaded filename and follow the ADB instructions to copy it back to your device.
5. Repeat the device setup after a Google Play update.

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
