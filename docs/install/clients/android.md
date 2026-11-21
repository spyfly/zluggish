---
sidebar_position: 4
description: Set up a non-rooted Android device to ride on your Zluggish server.
---

# Android

This procedure is for a device that is not rooted. For a rooted device, see [Android (rooted)](android-rooted.md). In the web app, **Set up Android** on the **Apps** page shows the same steps with the address of the server filled in.

Two apps do the work. Virtual Hosts redirects Zwift to Zluggish. ZofflineObb patches Zwift so that it accepts the shared zwift-offline certificate.

:::warning

ZofflineObb works only with a server that still uses the shared certificate, whose private key is public. A server with its [own certificate](../certificate.md) does not work with it.

:::

## Install the apps

1. Download and install `ZofflineObb.apk` from the [ZofflineObbAndroid releases](https://github.com/fatsbrown/ZofflineObbAndroid/releases/latest).
2. Download and install `app-Github-release.apk` from the [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
3. Make a file with the name `hosts.txt` on the device. Use a text editor app. Replace `<server-ip>` with the IP address of the Zluggish server:

   ```text
   <server-ip> us-or-rly101.zwift.com
   <server-ip> secure.zwift.com
   <server-ip> cdn.zwift.com
   ```

4. In the Android settings, turn off **Private DNS**.
5. Open Virtual Hosts and select `hosts.txt`.

Instead of Virtual Hosts, you can use the Zluggish DNS server:

1. Set `dns.enabled` to `true` in `zluggish.config.ts`. See [Configuration](../../reference/configuration.md).
2. On the phone, set **DNS 1** of the Wi-Fi connection to the IP address of the Zluggish server.

If your router can change DNS records, you can also set the records on the router.

## Patch Zwift

Do these steps after each installation or update of Zwift.

1. Install or update Zwift from Google Play. Do not start it yet.
2. If you started Zwift, go to **Android Settings → Applications → Zwift** and clear the data. You can also uninstall Zwift and install it again.
3. Open ZofflineObb and run it. Allow access to all files and installation from unknown sources.
4. Wait until the patch is complete. This takes 5 to 10 minutes.
5. Start Zwift. Zwift checks the download and starts.

If ZofflineObb does not work on your device, you can patch the OBB file on Windows. See [zwift-offline issue #505](https://github.com/zoffline/zwift-offline/issues/505).

## Ride

1. Make sure that the Virtual Hosts button is on.
2. Ask an administrator to make your user in the [web app](../../usage/web-app.md), under **Manage → Users**. Your user must have a password.
3. In Zwift, sign in with your username and password.
