---
sidebar_position: 2
description: Upload Zluggish activities to Garmin Connect.
---

# Garmin Connect

1. In the web app, go to **Integrations → Garmin**.
2. Save your Garmin credentials.
3. Select **Authorize**.
4. If Garmin asks for multi-factor authentication, enter the verification code.

Zluggish uploads FIT files to Garmin Connect. It does not need a Python helper or a separate Garmin image.

You can keep existing garth token files, `oauth1_token.json` and `oauth2_token.json`, in `storage/<local-player-id>/garth/`.

For a Garmin account in China, set `integrations.garmin.domain: 'garmin.cn'` in `zluggish.config.ts`.

Live Garmin login and upload are not fully verified yet.

## Planned workouts (Garmin Coach)

After you authorize Garmin (steps above), press **Sync workouts** on the Garmin card in the web app. Zluggish fetches the cycling workouts Garmin has scheduled for the next 14 days and serves them to the game. Garmin Coach plans and regular scheduled workouts both work.

- Garmin Coach plans target absolute watt ranges. Zluggish converts them to %FTP using your current cycling FTP, which it fetches from Garmin Connect on every sync.
- To pin an FTP instead, set `integrations.garmin.ftp` in `zluggish.config.ts`. Without it, or when Garmin exposes no FTP, steps without a zone number import without power targets.
