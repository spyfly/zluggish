# Contributing to Zluggish

Thank you for helping out. Zluggish is maintained by a small team in our spare time, so this guide is mostly about making good use of that time. Yours and ours.

## Getting started

You need [mise](https://mise.jdx.dev/getting-started.html). It installs the right versions of Node and pnpm for you. From the repository root, run:

```sh
cd server
mise install
mise run install
mise run check
```

`mise run check` builds, lints, typechecks and tests the server and its CLI. It also checks the formatting. Run it before you open a pull request. CI runs the same checks on Linux, Windows and macOS.

Other useful commands, run from `server/`:

| Command           | Result                                                    |
| ----------------- | --------------------------------------------------------- |
| `mise dev`        | Start the server from source.                             |
| `pnpm lint:fix`   | Fix lint problems.                                        |
| `pnpm format:fix` | Fix the formatting.                                       |
| `pnpm codegen`    | Regenerate the protobuf codecs after you change `proto/`. |

The web app is in `web/`. Build it with `pnpm --dir web build` and typecheck it with `pnpm --dir web check`.

## Talk to us first

For anything bigger than a bug fix or a small improvement, open an issue before you write the code. Describe what you want to change and why. For open-ended ideas and questions, start a [discussion](https://github.com/zluggish/zluggish/discussions) instead. With a small team, we can't promise to review every large pull request. A short conversation up front saves you from writing something we can't merge.

You don't need to ask before you fix a typo, a clear bug, or a broken link. Just open the pull request.

## Pull requests

- **Do one thing per pull request.** A pull request that fixes a bug and refactors the code around it is two pull requests. Small pull requests get reviewed and merged faster.
- **Use a [Conventional Commits](https://www.conventionalcommits.org/) title.** CI checks it. The allowed types are `feat`, `fix`, `docs`, `test`, `ci`, `refactor`, `perf`, `chore` and `revert`, for example `fix: keep ghost order after a regroup`. We squash pull requests when we merge them, so the title becomes the commit message on `main`.
- **Explain the change.** Say what the pull request changes, why, and how you tested it. If it changes the game or the web app, say which client you tested with.
- **Include screenshots for UI changes.** Attach screenshots showing the updated interface in the pull request description.
- **Add or update tests** when you change behaviour. If something is hard to test, say so in the description.
- **Commit generated files.** If you change `proto/`, run `pnpm codegen` and commit the result. CI fails if the generated files are out of date.
- **Update the README** if you add a setting or change how a feature works.

We may push small fixes to your branch, such as formatting or a typo, instead of asking you to do it. If you would rather we didn't, say so in the pull request.

## Scope

Zluggish is an offline server that you run for yourself, your household or your friends. We won't accept changes that:

- connect to Zwift's official servers or its multiplayer world,
- redistribute Zwift's client, game assets or other proprietary files, or
- are mainly useful for cheating on the official service.

If you aren't sure whether an idea fits, ask in an issue first.

## Reporting bugs

Search the existing issues first. If nobody has reported the problem yet, open an issue and include:

- the Zluggish version or Docker image tag,
- how you run the server (Docker or from source) and on which operating system,
- which Zwift client you use (Windows, macOS or Android),
- the steps to reproduce the problem, what you expected, and what happened instead, and
- the relevant server logs.

Remove passwords, tokens and other private data from logs and config files before you post them.

If you think you have found a security problem, don't open a public issue. Use [private vulnerability reporting](https://github.com/zluggish/zluggish/security/advisories/new) instead.

## Use of generative AI

You may use AI tools to help you write code. You are still the author, and you are responsible for every line you submit:

- **Understand your change.** You must be able to explain what each part of it does and answer questions about it in review. If you can't, don't open the pull request.
- **Test it yourself.** Run `mise run check`. For changes that affect the game, ride with them on a real client.
- **Keep it focused.** AI tools tend to rewrite more than the task needs. Remove unrelated changes before you submit.
- **Say so.** Mention in the pull request description that you used an AI tool, and for what.
- **Write or edit the pull request title and description yourself.** If an agent prepares the branch, have it give you the GitHub compare link so you can write or edit both fields in the pull request form before submitting.
- **Write issues and review comments in your own words.** Using a translation tool is fine.

We close pull requests that look generated without care, especially large ones that nobody has discussed with us first.

## Other ways to help

You don't have to write code to help:

- **Test on your setup.** Try new releases with your client and trainer, and report what breaks. Android and macOS clients get less testing than Windows.
- **Improve the documentation.** If a setup step confused you, a pull request that makes it clearer is very welcome.
- **Help other riders.** Answer questions from people who are setting up their own server.

## License

Zluggish is licensed under the [GNU Affero General Public License, version 3](LICENSE). When you contribute, you agree that your contribution is licensed under the same terms.
