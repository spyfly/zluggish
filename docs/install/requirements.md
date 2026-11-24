---
sidebar_position: 1
description: Server and client requirements for Zluggish.
---

# Requirements

Zluggish is for users with technical knowledge. It has two parts:

- The **server** keeps your progress and runs the ride services.
- The **client** is the device that runs the Zwift app, i.e. the game you see on screen.

The server and the client can be on the same computer, but they don't have to.

## Server

- A computer with Linux, Windows or macOS. Generally, performance requirements are low but we recommend 15gb of free space to host the Android apps.
- Docker Compose. Zluggish runs as a container.

## Client

You must patch the Zwift client to make it use Zluggish instead of the official servers. The webapp has automatic scripts to help you with that.

- [Windows](clients/windows.md)
- [macOS](clients/macos.md)
- [Linux](clients/linux.md)
- [Android](clients/android.md)

iPhone and iPad clients are not supported.

For the Zwift hardware requirements, see the [official system requirements](https://support.zwift.com/en_us/supported-devices-to-run-zwift-H1Cj9QbeB).
