---
sidebar_position: 6
description: Make the Zluggish server listen on IPv6.
---

# IPv6

IPv6 is optional. It is not fully tested on all platforms.

1. In `zluggish.config.ts`, set `network.host` to `'::'`. You can also set a `host` for each listener, under `network.api`, `network.cdn`, `network.tcp` and `network.udp`.
2. Set `server.advertisedIp` to an address that the client can reach.
3. Make the firewall rules and the client host entries agree with that address.
4. Start the server again.

The old `ZOFFLINE_SERVER_HOST` variable and the `run_ipv6.bat` script do not apply to Zluggish.
