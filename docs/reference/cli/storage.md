---
sidebar_position: 5
description: Back up, restore and clean the storage, and control activity uploads.
---

# Storage and upload commands

These commands run offline. Stop the server first. They use the storage of the selected config, or `--storage-dir`.

| Command                                        | Result                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage backup --output PATH`                 | Back up the database (a consistent SQLite copy), media, FIT exports, charts, encryption keys and the selected config, with a checksum manifest. Use a `.tar.gz` path for compression. |
| `storage restore --input PATH`                 | Check the checksums and keys of the archive or backup directory, then restore it. Uploads stay paused until you resume them.                                                          |
| `storage usage`                                | Show the storage use for each category.                                                                                                                                               |
| `storage cleanup [--dry-run]`                  | Apply the retention rules, or show their result. The server also applies them each day.                                                                                               |
| `storage clean-legacy [--confirm]`             | Show, or remove, old files that the storage merge imported. The command removes only files that are the same as in the migration backup and are in the database.                      |
| `uploads list`                                 | Show the deliveries that wait to be sent or need a decision. Show if uploads are paused.                                                                                              |
| `uploads pause`                                | Stop the automatic deliveries. Use it before the first start after you copy the storage manually.                                                                                     |
| `uploads cancel --activity ID --provider NAME` | Cancel one pending, failed or uncertain delivery.                                                                                                                                     |
| `uploads resume --confirm`                     | Allow the automatic deliveries again.                                                                                                                                                 |

```sh
node server/dist/src/cli/bin.js --storage-dir ./storage storage backup --output ./storage/backups/zluggish-2026-11-16.tar.gz
node server/dist/src/cli/bin.js --storage-dir ./storage storage restore --input ./storage/backups/zluggish-2026-11-16.tar.gz
node server/dist/src/cli/bin.js --storage-dir ./storage uploads list
node server/dist/src/cli/bin.js --storage-dir ./storage uploads resume --confirm
```

A restored backup cannot know which deliveries the providers received after the backup. For this reason, a restore pauses the uploads. Look at the providers, cancel the deliveries that they already have, then resume the uploads.

For the complete procedure, see [Back up and restore](../../maintenance/backup-and-restore.md).
