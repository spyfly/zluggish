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
