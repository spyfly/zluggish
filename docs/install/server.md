---
sidebar_position: 2
description: Install the Zluggish server with Docker Compose.
---

# Install the server

If you use legacy zwift-offline now, do the steps in [Migrate from zwift-offline](../maintenance/migrating.md) first.

## Install with Docker Compose

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

The server makes the `storage` directory on the first start. This directory holds the configuration, the users and the activities.

Backups are saved in `storage/backups/` on the host through the existing storage mount.

The [ports reference](../reference/ports.md) tells what each port is for.

## Build from source

1. Clone the [repository](https://github.com/zluggish/zluggish).
2. From the repository root, run:

   ```sh
   docker compose -f docker/docker-compose.yml up --build
   ```

This setup uses the `storage` directory in the repository root.

## First-time setup

In order to set up a new server, you must authenticate yourself as the administrator by entering the setup key. The docker output for the first-time zluggish server is something like

```text
zluggish-1  | ============================================================
zluggish-1  | Zluggish first-time setup
zluggish-1  | Open: http://127.0.0.1:8080/setup
zluggish-1  | Setup key: 0QZR-DVH3-9VES-E7PW-NS6C-CX2N-PWXQ-GA2R-MTR5-R122-REFP-PJF9-5XFG
zluggish-1  | This key works until setup is complete or the server stops.
zluggish-1  | ============================================================
```

:::warning

Keep the setup key private, don't share it with anybody

:::

Now open the setup address in a browser. The default address is `http://<server-ip>:8080/setup`.

Then paste the key into **Setup key**.

Enter a name, a login name and a password for the new user.

Select **Complete setup**.

This account is now the initial administrator.

## Next steps

See the [server documentation](../reference/configuration.md) for configuration, then set up the client for [Windows](clients/windows.md), [macOS](clients/macos.md) or [Android](clients/android.md).
