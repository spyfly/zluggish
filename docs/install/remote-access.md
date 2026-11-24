---
sidebar_position: 7
description: Reach the Zluggish web app and game server from outside your home network with Cloudflare Tunnel and Cloudflare One.
---

# Remote access

Zluggish is made for a local network. This page shows two ways to reach it from another place with [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/). You do not have to open ports on your router.

| Goal                      | Traffic            | What you need                                                                  |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------ |
| [Web app](#web-app)       | HTTP only          | `cloudflared` on the server and a public name                                  |
| [Zwift game](#zwift-game) | HTTPS, TCP and UDP | `cloudflared` on the server and the Cloudflare One Client on each Zwift device |

Both procedures need a Cloudflare account. The web app procedure also needs a domain that uses Cloudflare DNS.

## Web app

The web app uses only HTTP on port 8080. A public hostname in Cloudflare Tunnel is sufficient.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to **Zero Trust** > **Networks** > **Connectors** > **Cloudflare Tunnels**.
2. Select **Create a tunnel**, then **Cloudflared**. Give the tunnel a name, for example `zluggish`.
3. Install `cloudflared` on the Zluggish server with the command that the dashboard shows. The tunnel then shows as **Healthy**.
4. Add a public hostname, for example `zluggish.example.com`:
   - **Service type**: `HTTP`
   - **URL**: `localhost:8080`, or `<server-ip>:8080` if `cloudflared` runs on a different computer.
5. In `zluggish.config.ts`, set `network.web.publicUrl` to the public address:

   ```ts
   network: {
     web: {
       publicUrl: 'https://zluggish.example.com',
     },
   },
   ```

6. Start the server again.
7. Open `https://zluggish.example.com`.

Cloudflare gives the HTTPS certificate. With an `https` address, the sign-in cookies get the `Secure` flag. See [Use a reverse proxy](../usage/web-app.md#use-a-reverse-proxy).

:::warning

The public hostname makes the web app available to all of the internet. Add a [Cloudflare Access application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/) for the hostname, so that only the people that you select can open the page.

:::

## Zwift game

The game does not use only HTTP. It uses these ports on the Zluggish server:

| Port | Protocol | Use                              |
| ---- | -------- | -------------------------------- |
| 443  | HTTPS    | Launcher, game app and Zwift API |
| 80   | HTTP     | Zwift CDN                        |
| 3025 | TCP      | Game connection                  |
| 3024 | UDP      | Ride data                        |

The game also connects to the `zwift.com` names, not to a hostname that you select. A public hostname cannot carry this traffic. Instead, the tunnel routes your private network, and each Zwift device connects to it with the [Cloudflare One Client](https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/warp/) (previously WARP). The Zwift device then reaches the server at its private IP address, as on the local network.

### Route the private network

1. Make the tunnel as in steps 1 to 3 of [Web app](#web-app). You can use the same tunnel for the two procedures.
2. Open the tunnel and go to **CIDR routes**. Add the IP address of the Zluggish server, for example `192.168.1.10/32`. You can also add the full local network, for example `192.168.1.0/24`.
3. Go to **Zero Trust** > **Settings** > **WARP Client**. Open the device profile and go to **Split Tunnels**.
   - In **Exclude** mode (the default), remove the range that has your server address, for example `192.168.0.0/16`.
   - In **Include** mode, add the server address.
4. Go to **Zero Trust** > **Settings** > **Network**. Turn on **Proxy** and select **TCP** and **UDP**. The game needs UDP for ride data.

:::note

The private range must not be the same on the Zwift device and at home. If the two networks both use `192.168.1.0/24`, the device sends the traffic to its own network. Change the home range, for example to `10.42.0.0/24`.

:::

### Set up Zluggish

1. In `zluggish.config.ts`, set `server.advertisedIp` to the private IP address of the server, for example `192.168.1.10`. The game sends UDP and TCP traffic to this address.
2. Start the server again.

### Set up the Zwift device

1. Install the Cloudflare One Client and sign in to your Zero Trust organization.
2. Connect the client.
3. Set up the client as in [Windows](clients/windows.md), [macOS](clients/macos.md) or [Android](clients/android.md). Install the certificate. To send the Zwift names to the server, use a [Gateway DNS policy](#redirect-the-zwift-names-with-gateway-dns), or use the private IP address of the server as `<server-ip>` in the hosts file.
4. Start Zwift.

To make sure that the tunnel works, open `http://<server-ip>:8080` on the Zwift device while the client is connected.

### Redirect the Zwift names with Gateway DNS

When the Cloudflare One Client is connected, it sends DNS queries to Cloudflare Gateway. A Gateway DNS firewall policy with the **Override** action can answer the Zwift names with the address of your server. Then you do not have to change the hosts file on each device, and the redirect follows the device to any network.

This is the recommended method on Android and for Companion. Android does not let you change the hosts file without root, and a VPN app such as Virtual Hosts cannot run at the same time as the Cloudflare One Client.

1. Go to **Zero Trust** > **Traffic policies** > **Firewall policies** > **DNS**.
2. Add a policy:
   - **Name**: `Zluggish`
   - **Selector**: `Host`, **Operator**: `in`, **Value**: `secure.zwift.com`, `us-or-rly101.zwift.com`, `cdn.zwift.com` and `launcher.zwift.com`
   - **Action**: `Override`, **Override hostname**: the private IP address of the server, for example `192.168.1.10`
3. Save the policy.
4. Remove the Zluggish line from the hosts file on the Zwift devices, if it is there.

To apply the policy only to some users, add an identity condition, for example `User Email` `in` the addresses of your riders.

You must still install the certificate on each device. The DNS policy changes only the address.

On Android, turn off **Private DNS** in the Android settings. Otherwise Android can send DNS queries past the client, and the override does not apply.

:::warning

The policy applies to all devices in your organization. While the client is connected, these devices cannot reach the official Zwift servers. For Companion, leave out `cdn.zwift.com`, as in [Zwift Companion app](companion-app.md).

:::
