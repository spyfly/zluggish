---
sidebar_position: 2
description: Install the Zluggish server with Docker Compose.
---

# Install the server

If you currently use the legacy zwift-offline app, first read the [migration guide](../maintenance/migrating.md).

1. Make an empty directory on the server, for example `/etc/zluggish`.
2. Download the [Docker Compose file](https://github.com/zluggish/zluggish/blob/main/docker/docker-compose.yml) to that directory and name it `docker-compose.yml`.

3. Start the server from that directory:

   ```sh
   docker compose up -d
   ```

4. Look at the server output. Make sure that it shows this line:

   ```sh
   zluggish-1  | 2026-11-17T11:40:23.126Z INFO server.ready Zluggish is ready
   ```

The server creates automatically creates the `storage` directory on first start which holds configuration, database, and any other files needed.

## Build from source

We generally discourage this install method and prefer you use docker compose.

1. Clone the [repository](https://github.com/zluggish/zluggish).
2. From the repository root, run:

   ```sh
   docker compose -f docker/docker-compose.yml up --build
   ```

## First-time setup

Find the setup key in the server logs:

```text
zluggish-1  | ============================================================
zluggish-1  | Zluggish first-time setup
zluggish-1  | Open: http://127.0.0.1:8080/setup
zluggish-1  | Setup key: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX
zluggish-1  | Valid until setup is complete or the server stops.
zluggish-1  | ============================================================
```

:::warning

Keep the setup key private, don't share it with anybody

:::

1. Open `http://<server-ip>:8080/setup`.
2. Paste the key into **Setup key** and select **Check key**.
3. Enter a name, login name and password.
4. Select **Complete setup**. This account becomes the first administrator.

## Next steps

See the [server documentation](../reference/configuration.md) for configuration, then set up the client for [Windows](clients/windows.md), [macOS](clients/macos.md) or [Android](clients/android.md).
