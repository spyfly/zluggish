---
sidebar_position: 5
description: Set up a rooted Android device to ride on your Zluggish server.
---

# Android (rooted)

This procedure makes Zwift trust the [server certificate](../certificate.md) and redirects Zwift to Zluggish.

## Add the certificate

1. Install Zwift on the device.
2. Start Zwift once, so that it downloads all the extra files. The file `cacert.pem` exists only after this first start.
3. In the Zluggish web app, select **Apps** in the menu, then **Client**. If it opens a setup, select **Choose another system**. Under the system buttons, select **certificate** to download it as a `.crt` file.
4. Add the contents of the `.crt` file to the end of `/data/data/com.zwift.zwiftgame/dataES/cacert.pem`.

If the device has no text editor, use `adb`:

1. Copy the certificate to the device:

   ```sh
   adb push zluggish-zwift-*.crt /data/data/com.zwift.zwiftgame/dataES/zluggish.crt
   ```

2. Open a shell on the device with `adb shell`.
3. Go to the Zwift data directory:

   ```sh
   cd /data/data/com.zwift.zwiftgame/dataES/
   ```

4. Add the certificate to the file:

   ```sh
   cat zluggish.crt >> cacert.pem
   ```

:::warning

Make sure that the permissions and the owner of `cacert.pem` do not change.

:::

## Redirect Zwift

1. Open `/etc/hosts` on the device.
2. Add this line to the end of the file. Replace `<server-ip>` with the IP address of the Zluggish server:

   ```text
   <server-ip> us-or-rly101.zwift.com secure.zwift.com cdn.zwift.com
   ```

If the device has no text editor, use `adb`:

1. Copy the file to your computer with `adb pull /etc/hosts`.
2. Edit the file on your computer.
3. Copy the file back with `adb push hosts /etc/hosts`.

If your router can change DNS records, you can set the records on the router instead.

## Ride

1. Ask an administrator to make your user in the [web app](../../usage/web-app.md), under **Manage → Users**. Your user must have a password.
2. In Zwift, sign in with your username and password.
