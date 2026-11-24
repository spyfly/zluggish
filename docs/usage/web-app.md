---
sidebar_position: 1
description: Use the Zluggish web app to manage rides, accounts and the server.
---

# Web app

On the server computer, open [http://localhost:8080](http://localhost:8080). For a browser on another device, use an HTTPS address through a [reverse proxy](#use-a-reverse-proxy) or [Cloudflare Tunnel](../install/remote-access.md#web-app). The web app uses browser features that require HTTPS or a loopback address such as `localhost`.

To create the first administrator, follow [First-time setup](../install/server.md#first-time-setup).

## Rider pages

| Page         | What you can do                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Activities   | Browse rides by month. View the route, elevation and ride statistics. Download FIT files and images.                           |
| Profile      | Edit your profile and avatar, change your password, and use **Import / Export** to transfer data.                              |
| Climbs       | See the climb portals you have ridden and your best times.                                                                     |
| Integrations | Set up [activity uploads and workout imports](integrations/index.md).                                                          |
| Settings     | Toggle ghosts and regenerate power curves.                                                                                     |
| Apps         | Set up Zwift for Windows, macOS, Linux or Android, or [install Companion on Android](../install/clients/companion-android.md). |

## Administrator pages

Open **Manage** in the sidebar.

- **Users** lets you create, disable or delete accounts, set passwords, change roles and end sessions.
- **Android apps** lets you publish [Zwift](../install/clients/android.md#publish-zwift-for-android) and [Companion](../install/companion-app.md) builds for your server.
- **Server** lets you rotate the [certificate](../install/certificate.md), [start a backup](../maintenance/backup-and-restore.md), read logs and manage bots, events and world settings.

## Use a reverse proxy

1. Configure your HTTPS proxy to forward requests to the web listener, which defaults to HTTP port 8080.
2. Set `network.web.publicUrl` to the browser-facing origin, such as `https://zluggish.example.com`.
3. Restart Zluggish and use that address to sign in.

Zluggish checks the origin on requests that change data. An HTTPS origin also makes session cookies secure. If you open the web app at a different address after setting `publicUrl`, sign-in and changes can fail.

When the web app is enabled and has a public URL, the game launcher links to it with **Manage your account**.

## Turn off the web app

Complete setup and create your riders first. Set `network.web.enabled` to `false` in `zluggish.config.ts` and restart the server. Riders with a password can still sign in through Zwift. The server continues to save rides and run configured activity uploads.
