# Security Policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Instead, report them privately by opening a GitHub security advisory on the
repository or by emailing the maintainers directly.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce.
- Affected versions.
- Any suggested fix, if you have one.

You should receive a response within a few days. If you do not, please follow
up.

## Scope

This project is a **local, single-user** macOS app. It binds to
`127.0.0.1` and is not intended to be exposed to a network. Please consider
this when assessing the severity of a report.

## Security notes for users

- **API keys** — the app reads your LLM provider key from
  `packages/app/.env`. Never commit this file or share it. It is already
  excluded by `.gitignore`.
- **Local-only** — the server binds to `127.0.0.1` by default. Do not expose it
  to a public network.
- **Audio privacy** — transcription runs locally; audio is not uploaded. The
  LLM analyst sends only the transcribed text to your configured provider.

## Supported versions

Only the latest release on the `main` branch is supported. Security fixes are
released as part of the next version.
