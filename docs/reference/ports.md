---
sidebar_position: 2
description: The network ports that Zluggish uses.
---

# Ports

For a server on a different computer, set `server.advertisedIp`. Then open these ports on the local network. This lets riders in your home ride together. It does not give access to the public Zwift world.

| Port | Protocol | Use                                |
| ---- | -------- | ---------------------------------- |
| 80   | HTTP     | Zwift CDN only                     |
| 443  | HTTPS    | Game app and Zwift API only        |
| 8080 | HTTP     | Web app (users and administrators) |
| 3025 | TCP      | Game connection                    |
| 3024 | UDP      | Ride data                          |
| 53   | UDP      | Optional DNS (`dns.enabled`)       |

:::warning

Keep Zluggish on a local network that you trust. It is not designed for the public internet. To reach it from another place, see [Remote access](../install/remote-access.md).

:::

## Optional DNS with Docker

The supplied Compose file leaves UDP port 53 unpublished. If you want Zluggish to resolve the Zwift hostnames:

1. In `zluggish.config.ts`, set `dns.enabled` to `true` and `server.advertisedIp` to the server's LAN IP.
2. Add a UDP port mapping under the `zluggish` service's existing `ports` list. Replace the example IP with the server's LAN IP:

   ```yaml
   - '192.168.1.10:53:53/udp'
   ```

3. Run `docker compose up -d` from the Compose directory.

Binding to the LAN IP avoids a collision with a resolver listening only on loopback, such as [systemd-resolved](https://www.freedesktop.org/software/systemd/man/latest/systemd-resolved.service.html). If UDP port 53 is already in use on the LAN IP, leave Zluggish DNS off and use your existing DNS server for the overrides.
