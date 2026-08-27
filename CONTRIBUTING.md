# Contributing to Roofle

Thanks for taking the time to contribute! This guide covers how to set up the
project, run checks, and submit changes.

## Code of conduct

This project and everyone participating in it is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to
uphold this code.

## Getting started

1. **Fork** the repository and clone your fork.
2. **Install dependencies** — `npm install` compiles the native addon and
   creates the Python virtualenv with the WhisperX requirements.
3. **Create a branch** for your work: `git checkout -b my-feature`.
4. **Make your changes** and add tests where appropriate.
5. **Run the checks** (below).
6. **Commit** with a clear message and open a pull request.

## Development setup

```bash
npm install          # installs JS deps + builds native addon + Python venv
npm run dev          # build all packages and start the Node server
```

Open <http://127.0.0.1:8080> to see the UI. See the
[README](README.md#quick-start) for full setup, including macOS permissions.

## Checks

Run these before submitting a pull request:

```bash
npm run typecheck    # type-check all packages
npm run test         # run unit tests
npm run build        # compile all packages
```

## Project structure

```
packages/
├── shared/          # typed contracts shared across packages
├── transcriber/     # audio capture + pipeline + WhisperX server
├── analyst/         # LangGraph agent + SQLite
└── app/             # Node HTTP + WebSocket server + browser UI
```

## Guidelines

- Keep changes focused. Prefer small, reviewable pull requests.
- Follow the existing code style and TypeScript conventions.
- Add or update tests for any behavior you change.
- Update the README or docs if your change affects usage or configuration.
- Do not commit secrets, `.env` files, databases, or build artifacts.

## Reporting bugs

Open an issue with:

- A clear, descriptive title.
- Steps to reproduce.
- Expected vs. actual behavior.
- Your environment (macOS version, Node version, model, provider).

## Feature requests

Open an issue describing the problem you want to solve and a proposed approach.
Discussion happens in the issue before implementation.
