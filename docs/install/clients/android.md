---
sidebar_position: 4
description: Set up a non-rooted Android device to ride on your Zluggish server.
---

# Android

This procedure is for a device that is not rooted. For a rooted device, see [Android (rooted)](android-rooted.md). In the web app, **Set up Android** on the **Apps** page shows the same steps with the address of the server filled in.

Zwift from Google Play stores its certificate bundle in an expansion file. Patch your copy of that file with your Zluggish server’s certificate, then use Virtual Hosts or DNS to send Zwift to the server.

## Patch the expansion file

1. Install or update Zwift from Google Play and leave it closed.
2. Enable USB debugging and connect your Android device to a computer with ADB.
3. Sign in to the Zluggish web app on your computer and open **Apps → Zwift → Android**. Follow the ADB instructions there to copy the `main.*.com.zwift.zwiftgame.obb` file from the device, upload it, and download the patched file.
4. If you already started Zwift, clear its app storage in Android settings. Save the patched file in a separate folder so it keeps its original name, then follow the ADB instructions to copy it back to your device.
5. Repeat the patch after each Play Store update.

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
