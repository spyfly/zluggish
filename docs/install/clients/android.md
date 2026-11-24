---
sidebar_position: 4
description: Install Zwift for Zluggish on Android and send game traffic to your server.
---

# Android

**Zwift for Zluggish** trusts your server's certificate and installs alongside Zwift from Google Play. It works without root.

## Install Zwift

1. In the [web app](../../usage/web-app.md), open **Apps → Zwift → Android** on the Android device.
2. Select **Download Zwift**. The page shows the version and download size. If a download is unavailable, ask your administrator to [publish the app](#publish-zwift-for-android).
3. Open the downloaded file and allow your browser to install it. If Play Protect prompts about the unknown app, select **Install anyway**.
4. [Point the Zwift names at your server](#point-zwift-at-zluggish).
5. Open **Zwift for Zluggish** and sign in with your Zluggish login name and password. The first launch unpacks the game files.

When the administrator publishes a new version or [rotates the certificate](../certificate.md), install the new download from the same page.

## Point Zwift at Zluggish

Use the hostnames and server IP shown on the setup page. Pick one method:

- **Router DNS**. Add the hostnames as local DNS records on a router that supports overrides. Use the router's DNS on the Android device.
- **Zluggish DNS**. [Enable the optional DNS listener](../../reference/ports.md#optional-dns-with-docker), then set the Android device's Wi-Fi DNS to the Zluggish server's LAN IP.
- **Cloudflare One Client**. For remote play, use a [Gateway DNS override](../remote-access.md#redirect-the-zwift-names-with-gateway-dns).
- **Virtual Hosts**. Use the app below for a redirect on a single device.

If Android's **Private DNS** setting bypasses your chosen DNS server, turn it off for the setup. The redirect applies to both installed copies of Zwift. Disable it before using the official service.

### Virtual Hosts

[Virtual Hosts](https://github.com/x-falcon/Virtual-Hosts/releases/latest) uses Android's VPN slot. Use it by itself and choose another DNS method if Android cannot install it.

1. Install `app-Github-release.apk` from the release page.
2. Save the host entries from the Zluggish setup page as `hosts.txt` on the device.
3. Open Virtual Hosts, select `hosts.txt` and turn it on.

## Publish Zwift for Android

An administrator does this once per app version.

1. Open **Manage → Android apps → Zwift**.
2. Select **Download and build** if offered. To upload instead, get the **BUNDLE 1 OBB** variant from [APKMirror](https://www.apkmirror.com/apk/zwift-inc/zwift/) and drop the `.apkm` file on the upload area.
3. For an upload, keep the page open until it finishes. The server builds the app in the background and shows its progress on the same page.

The build status shows the recommended free space. The first build may download Java and APKEditor, which the [Companion patcher](../companion-app.md#build-tools-and-backups) also uses. The server keeps the last upload so **Build again** can rebuild it.

The upload, published app and signing key are excluded from [server backups](../../maintenance/backup-and-restore.md). Save `storage/zwift-android/signer.pem` separately if you need to install future builds over existing copies.
