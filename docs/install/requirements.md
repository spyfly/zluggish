---
sidebar_position: 1
description: Server and client requirements for Zluggish.
---

# Requirements

Zluggish is for users with technical knowledge. It has two parts:

- The **server** keeps your progress and runs the ride services.
- The **client** is the device that runs the Zwift app.

The server and the client can be on the same computer. They can also be on different computers on the same network.

## Server

- A computer with Linux, Windows or macOS. The server needs very little performance.
- Docker Compose. Zluggish runs as a container.

To run from source without Docker, use Node.js 26 and pnpm 12. See [Run the CLI natively](../reference/cli/index.md#run-natively).

## Client

You must patch the Zwift client. Windows, macOS and Linux have a setup script in the web app.

- [Windows](clients/windows.md)
- [macOS](clients/macos.md)
- [Linux](clients/linux.md)
- [Android](clients/android.md). Android needs manual patching.

iPhone and iPad clients are not supported.

For the Zwift hardware requirements, see the [official system requirements](https://support.zwift.com/en_us/supported-devices-to-run-zwift-H1Cj9QbeB).
