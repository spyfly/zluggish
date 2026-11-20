---
sidebar_position: 1
description: The zluggish.config.ts operator configuration file.
---

# Configuration

The container makes `storage/zluggish.config.ts` on the first start, if the file does not exist. To change a setting, edit this file, then make the container again:

```sh
docker compose up -d --force-recreate
```

This example sets the advertised IP address and the API listener:

```ts
import { defineConfig } from 'zluggish/config';

export default defineConfig({
  storageDir: '../storage',
  server: { advertisedIp: '192.168.1.10' },
  network: { host: '0.0.0.0', api: { port: 443, useCert: true } },
});
```

A complete example is in [`examples/reference/zluggish.config.ts`](https://github.com/zluggish/zluggish/blob/main/examples/reference/zluggish.config.ts).

## Rules

- `server.advertisedIp` must be an IP address that the game can reach. It cannot be a wildcard address.
- Each listener host must be an IP address or a host name. It cannot be empty. To listen on all IPv4 interfaces, use `0.0.0.0`.
- If a setting is not valid or not known, the server does not start.
- Config files are TypeScript code. Use only config files that you trust.
- The server reads the file only when it starts. After a change, start the server again.

To check a config before you start the server, use [`config validate`](cli/configuration.md).

## Web app listener

Set the web app listener under `network.web`:

```ts
network: {
  web: {
    enabled: true, // Set to false after setup to turn off the web app.
    host: null, // Defaults to network.host.
    port: 8080,
    publicUrl: 'https://zluggish.example.com', // For a reverse proxy.
  },
},
```

For the effect of `enabled` and `publicUrl`, see [Web app](../usage/web-app.md).

## Logging

Set the log level and format under `logging`. See [Logging](../troubleshooting/logging.md).

## Other settings

Most features have their settings on their own page:

| Setting                           | Page                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| `tls`                             | [Server certificate](../install/certificate.md)            |
| `dns.enabled`                     | [Android](../install/clients/android.md)                   |
| `network.host` and listener hosts | [IPv6](../install/ipv6.md)                                 |
| `bots`                            | [Bots](../usage/features/bots.md)                          |
| `pelotons`                        | [Pelotons](../usage/features/pelotons.md)                  |
| `leaderboards.allTime`            | [All-time leaderboards](../usage/features/leaderboards.md) |
| `equipment`                       | [Entitlements](../usage/features/entitlements.md)          |
| `proxy.mode`                      | [CDN proxy](../usage/features/cdn-proxy.md)                |
| `integrations.garmin.domain`      | [Garmin Connect](../usage/integrations/garmin.md)          |
| `integrations.discord`            | [Discord bridge](../usage/chat-bridges/discord.md)         |
| `integrations.matrix`             | [Matrix bridge](../usage/chat-bridges/matrix.md)           |
