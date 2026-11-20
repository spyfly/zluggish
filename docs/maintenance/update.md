---
sidebar_position: 1
description: Update the Zluggish server and keep the Zwift client compatible.
---

# Update

## Update the server

1. Read the [CHANGELOG](https://github.com/zluggish/zluggish/blob/main/CHANGELOG). Some changes need an action from the operator.
2. Back up the storage. See [Back up and restore](backup-and-restore.md).
3. If the old container has backups in a Docker volume, [copy them to the host](backup-and-restore.md#recover-backups-from-an-older-docker-container) before recreating it.
4. In the directory with `docker-compose.yml`, get the new image and start it:

   ```sh
   docker compose pull && docker compose up -d
   ```

## Update the Zwift client

Zwift updates can break compatibility with Zluggish. The client redirection can also stop normal updates.

1. Switch the client back to the official service. See [Uninstall](uninstall.md).
2. Update Zwift.
3. Make sure that Zluggish supports the new Zwift version.
4. Set up the client redirection again.

If Zluggish is older than the Zwift client, see [Zwift client updates](../troubleshooting/client-updates.md).
