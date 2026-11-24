---
sidebar_position: 5
description: Connect Zwift Companion on Android to Zluggish.
---

# Companion (Android)

The patched Companion app has the Zluggish icon and installs alongside the official app. It works without root.

1. In the [web app](../../usage/web-app.md), open **Apps → Zwift Companion → Android** on the Android device.
2. Download and install the patched Companion app. If the download is missing or uses an old certificate, ask your administrator to [publish an updated build](../companion-app.md#add-the-app-to-the-server).
3. Point `secure.zwift.com` and `us-or-rly101.zwift.com` at your Zluggish server. Copy the entries from the setup page into [Virtual Hosts](android.md#virtual-hosts), or add them to your router's DNS or [Cloudflare Gateway policy](../remote-access.md#redirect-the-zwift-names-with-gateway-dns). Leave `cdn.zwift.com` on public DNS for Companion images.
4. Open Companion with the Zluggish icon and sign in with your Zluggish account.

If Android uses a different resolver, check **Private DNS** in Android settings. The redirect affects both Companion installs. Turn it off before signing in to the official service.

When your administrator publishes an update or [rotates the server certificate](../certificate.md), download and install the new build from the same setup page.
