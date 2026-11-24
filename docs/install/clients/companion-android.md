---
sidebar_position: 5
description: Set up Zwift Companion on Android for Zluggish
---

# Companion (Android)

How to set up Zwift Companion on Android to talk to Zluggish.

Use the patched Zwift Companion app from your Zluggish server. It trusts the server's certificate and has the
Zluggish icon. You can keep the official Companion app installed alongside it. No root access is needed.

## Install the app

1. On the Android device, sign in to the Zluggish web app and select **Apps** in the menu.
2. Select **Android** under **Zwift Companion**. The setup page shows the server address and the available app version.
3. Download the patched Companion app, then open the downloaded file.
4. Allow your browser to install apps, then select **Install**. If Play Protect warns about an unknown app, select
   **Install anyway**.

If the page says that no app is available, ask the administrator to [publish Companion](../companion-app.md#add-the-app-to-the-server)
first. If it says the app was made for an old certificate, ask the administrator to update it before downloading.

## Point Companion at Zluggish

1. Install `app-Github-release.apk` from the
   [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
2. Copy the host entries from the Companion setup page into a file named `hosts.txt` on the device. They look like
   this; replace `<server-ip>` with the IP address of your Zluggish server:

   ```text
   <server-ip> us-or-rly101.zwift.com
   <server-ip> secure.zwift.com
   ```

3. Turn off **Private DNS** in Android settings.
4. Open Virtual Hosts, select `hosts.txt` and turn it on.

:::warning

Do not add `cdn.zwift.com` to the Companion hosts file. Companion downloads images from the official server.

:::

Instead of Virtual Hosts, the administrator can enable Zluggish DNS with `dns.enabled: true` in `zluggish.config.ts`.
Set the Wi-Fi connection's primary DNS server to the Zluggish server's IP address. A router with local DNS overrides
can also provide the two host records. See [Configuration](../../reference/configuration.md).

## Sign in

Keep Virtual Hosts on, open Companion with the Zluggish icon and sign in with your Zluggish account, the same one
you use in the web app and the game.

While the DNS override is active, both Companion installs on the device point at Zluggish. Turn it off before
using the official Companion app with the official Zwift servers.

## Update the app

When the administrator publishes a new version or rotates the server certificate, return to the Companion setup
page and install the new download over the existing app. An app made for an old certificate cannot connect.
