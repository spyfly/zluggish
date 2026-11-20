---
slug: /
title: Zluggish
sidebar_position: 1
description: Zluggish is a self-hosted, open-source Zwift server that you run on your own network.
---

# Zluggish

Zluggish is a self-hosted, open-source server for [Zwift](https://zwift.com), written in TypeScript. It gives features that the official service does not have.

Zluggish is a rewrite of [zwift-offline](https://github.com/zoffline/zwift-offline) and [its fork](https://github.com/fatsbrown/zwift-offline). If you use one of them now, read [Migrate from zwift-offline](maintenance/migrating.md) first.

![The Zluggish web app showing a month of rides, with the route map, elevation profile and power and heart rate stats of the selected ride](../media/screenshots/webapp-activities.png)

## Features

- **Offline play**: ride with no connection to the Zwift servers.
- **Any map**: ride on the world that you select. The official schedule does not apply.
- **Your own ghosts**: ride with your previous efforts. Use chat to regroup the ghosts.
- **Custom RoboPacers and pelotons**: make pacers from recorded rides. Add followers and set group size, equipment, formation and rider strength.
- **Bookmarks**: save named positions during a ride. Start a new session from a bookmark, or teleport to it.
- **Intervals.icu planned workouts**: get scheduled workouts in the game launcher. Send completed activities back to Intervals.icu.
- **Web app**: manage users, settings, activities, integrations and the server from a browser.
- **Local records and data**: keep profiles, activities and recordings in storage that you can back up. All-time leaderboards are optional.
- **Equipment and progression control**: set the available equipment and Drop balances on your server.

:::note[Zluggish is offline only]

Zluggish does not connect to the public Zwift world. You cannot join official races, group rides, club events or global leaderboards. Your local progress is separate from your official Zwift account.

You can ride with family or friends who connect to the same Zluggish server.

:::

Each rider selects their name in the game launcher. Then the rider selects a map and a climb and starts Zwift.

![The launcher's Who's riding? screen listing five riders with their avatars](../media/screenshots/launcher-riders.png)

![The launcher after signing in, with Map and Climb choices and a Start Zwift button](../media/screenshots/launcher-dashboard.png)

## Get started

1. Read the [requirements](install/requirements.md).
2. [Install the server](install/server.md).
3. Do the [first-time setup](install/server.md#first-time-setup).
4. Set up the client for [Windows](install/clients/windows.md), [macOS](install/clients/macos.md), [Linux](install/clients/linux.md) or [Android](install/clients/android.md).

## Community

Join the community [Discord server](https://discord.gg/GMdn8F8) and the [Strava club](https://www.strava.com/clubs/zoffline).

## Legal notice

Zluggish is an independent community project. It is **not affiliated with, endorsed by, sponsored by, or officially supported by Zwift, Inc.** Zwift is a trademark of Zwift, Inc.

Zluggish uses the [GNU Affero General Public License, version 3](https://github.com/zluggish/zluggish/blob/main/LICENSE). This license does not give rights to the Zwift client, game assets or trademarks. The [README](https://github.com/zluggish/zluggish#legal-notice) has the full notice.
