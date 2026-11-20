import { ManagementService } from '#src/services/management.service';
import { runtimeFixture } from '#tests/support/runtime';
import { createWebApp } from '#src/http/web-app';
import { serve } from '@hono/node-server';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { once } from 'node:events';
import { test } from 'node:test';

for (const existing of [false, true]) {
  await test(
    `web setup with ${existing ? 'existing' : 'new'} rider, management, and game login`,
    { timeout: 40_000 },
    async (t) => {
      const f = runtimeFixture(t);

      const owner = existing ? await f.accounts.create('First Rider', 'test-password', 'owner') : null;
      const key = f.effects.runSync(ManagementService.use((management) => management.issueSetupKey()))!;
      const web = serve({ fetch: createWebApp(f).fetch, hostname: '127.0.0.1', port: 0 });
      const game = serve({ fetch: f.app.fetch, hostname: '127.0.0.1', port: 0 });
      t.after(() => {
        web.close();
        game.close();
      });
      await Promise.all([web, game].flatMap((s) => (s.listening ? [] : [once(s, 'listening')])));
      const address = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Finite }))(web.address());
      const gameAddress = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Finite }))(game.address());
      const origin = `http://127.0.0.1:${address.port}`;
      const browser = await chromium.launch();
      t.after(() => browser.close());
      const page = await browser.newPage({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(7000);
      const errors: Array<string> = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });
      await page.goto(origin + '/setup');
      await page.getByLabel('Setup key').fill('wrong-key');
      await page.getByRole('button', { name: 'Check key' }).click();
      await page.getByText('This key does not match.').waitFor();
      await page.getByLabel('Setup key').fill(key);
      await page.getByRole('button', { name: 'Check key' }).click();
      await page.getByText('Setup key accepted').waitFor();

      assert.equal(await page.getByRole('button', { name: 'Change key' }).count(), 0);

      if (owner) {
        await page.getByLabel('Use an existing user').check();
        await page.getByLabel('User', { exact: true }).selectOption(String(owner.player_id));
        assert.equal(await page.getByLabel('Login name', { exact: true }).count(), 0);
        await page.getByLabel('User’s password', { exact: true }).fill('wrong-password');
        await page.getByRole('button', { name: 'Complete setup' }).click();
        await page.getByRole('alert').waitFor();
        await page.getByLabel('User', { exact: true }).waitFor();
        await page.getByLabel('User’s password', { exact: true }).fill('test-password');
      } else {
        assert.equal(await page.getByLabel('Use an existing user').count(), 0);
        await page.getByLabel('Login name', { exact: true }).fill('owner');
        await page.getByLabel('Password', { exact: true }).fill('test-password');
        await page.getByLabel('First name', { exact: true }).fill('First');
        await page.getByLabel('Last name', { exact: true }).fill('Rider');
        await page.getByLabel('Confirm password', { exact: true }).fill('test-password');
      }

      await page.getByRole('button', { name: 'Complete setup' }).click();
      // Setup lands in the management area.
      await page
        .getByText('No other users yet. Create a user so that somebody else can ride on this server.', {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator('main[data-page="manage"]').count(), 1);
      await page.getByRole('button', { name: 'Create user' }).click();
      // Creating a user is its own page with one form.
      const create = page.locator('form').filter({ has: page.getByLabel('Confirm password', { exact: true }) });
      await create.getByLabel('First name').fill('Second');
      await create.getByLabel('Last name').fill('Rider');
      await create.getByLabel('Login name').fill('second');
      await create.getByLabel('Password', { exact: true }).fill('second-password');
      await create.getByLabel('Confirm password', { exact: true }).fill('second-password');
      await create.getByRole('button', { name: 'Create user' }).click();
      await page.getByText('Second Rider can now sign in.', { exact: true }).waitFor();
      assert.match(page.url(), /\/manage\/users\/\d+$/);

      // Destructive actions ask first, and the dialog names the rider.
      await page.getByRole('button', { name: 'End sessions', exact: true }).click();
      await page.getByRole('alertdialog', { name: 'End all sessions of Second Rider?' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('alertdialog').count(), 0);

      // Every page is one item in the side menu.
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('link', { name: 'Profile', exact: true }).click();
      await page.getByRole('heading', { name: 'Profile' }).waitFor();
      assert.equal(await page.locator('main[data-page="manage"]').count(), 0);
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByLabel('Login name', { exact: true }).fill('owner');
      await page.getByLabel('Password', { exact: true }).fill('test-password');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('link', { name: 'Users', exact: true }).click();
      await page.getByRole('link', { name: /Second Rider/ }).waitFor();

      // A deep link loads the rider directly.
      await page.goto(page.url().replace(/\/manage.*$/, '/manage/users/2'));
      await page
        .getByRole('region', { name: 'Account', exact: true })
        .getByText('Second Rider', { exact: true })
        .waitFor();
      await page.getByRole('heading', { name: 'Access', exact: true }).waitFor();
      await page.goto(`${origin}/manage/server`);
      const logOutput = page.getByRole('region', { name: 'Server log entries' });
      f.world.lifecycle.log.info('server.test', 'Browser test log entry');
      assert.equal(await logOutput.count(), 0);
      await page.getByRole('button', { name: 'View logs' }).click();
      await logOutput.getByText('Browser test log entry', { exact: false }).waitFor();
      f.world.lifecycle.log.info('server.test', 'Browser test refreshed entry');
      await page.getByRole('button', { name: 'Refresh logs' }).click();
      await logOutput.getByText('Browser test refreshed entry', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Hide logs' }).click();
      await logOutput.waitFor({ state: 'hidden' });

      const gamePage = await browser.newPage();
      await gamePage.goto(`http://127.0.0.1:${gameAddress.port}/login/`);
      await gamePage.getByRole('button', { name: /Second Rider/ }).click();
      await gamePage.getByLabel('Password', { exact: true }).fill('second-password');
      await gamePage.getByRole('button', { name: 'Sign in', exact: true }).click();
      await gamePage.waitForURL('**/user/**');
      assert.deepEqual(errors, []);
    },
  );
}
