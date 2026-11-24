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

Companion needs these two names to point at the server. Replace `<server-ip>` with the IP address of your Zluggish
server:

```text
<server-ip> us-or-rly101.zwift.com
<server-ip> secure.zwift.com
```

Android does not let you edit the hosts file without root. Use one of these, in order of preference:

- **Zluggish DNS**: the administrator sets `dns.enabled: true` in `zluggish.config.ts`. Set the Wi-Fi connection's
  primary DNS server to the Zluggish server's IP address. See [Configuration](../../reference/configuration.md).
- **Router**: add the two host records on a router that supports local DNS overrides.
- **Cloudflare Gateway**: if the phone uses the Cloudflare One Client (WARP), a Gateway DNS policy can override the
  two names. This also works on mobile data. See
  [Remote access](../remote-access.md#redirect-the-zwift-names-with-gateway-dns).
- **Virtual Hosts**: use this only if none of the above works. See [Virtual Hosts](#virtual-hosts).

Turn off **Private DNS** in Android settings. Otherwise Android can skip the DNS server that has the Zluggish records.

:::warning

Do not point `cdn.zwift.com` at Zluggish for Companion. Companion downloads images from the official server.

:::

### Virtual Hosts

[Virtual Hosts](https://github.com/x-falcon/Virtual-Hosts) is a VPN app that redirects host names without root. It
is no longer updated: its latest release is several years old, and newer Android versions can warn about it or refuse
to install it. You cannot use it together with another VPN, such as the Cloudflare One Client.

1. Install `app-Github-release.apk` from the
   [Virtual Hosts releases](https://github.com/x-falcon/Virtual-Hosts/releases/latest).
2. Copy the host entries from the Companion setup page into a file named `hosts.txt` on the device.
3. Open Virtual Hosts, select `hosts.txt` and turn it on.

## Sign in

Make sure that the DNS redirect is active, then open Companion with the Zluggish icon and sign in with your Zluggish
account, the same one you use in the web app and the game.

While the DNS override is active, both Companion installs on the device point at Zluggish. Turn it off before
using the official Companion app with the official Zwift servers.

## Update the app

When the administrator publishes a new version or rotates the server certificate, return to the Companion setup
page and install the new download over the existing app. An app made for an old certificate cannot connect.
