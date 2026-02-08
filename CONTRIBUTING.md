# Contributing to OpenMoose

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/OpenMoose/openmoose.git
cd openmoose
cp .env.example .env
pnpm install
```

## Code Style

- TypeScript with strict mode
- ESLint for linting: `pnpm lint`
- Keep files under 300 lines -- refactor if they grow beyond that
- Use the project `logger` instead of `console.log`
- All code execution must go through the Docker sandbox (never `exec` on host)

## Testing

```bash
pnpm test          # run all tests
pnpm test --watch  # watch mode
```

Tests use [Vitest](https://vitest.dev). Place test files next to the source file they cover (`foo.test.ts` alongside `foo.ts`).

## Pull Requests

1. Fork and create a feature branch from `main`.
2. Make your changes with clear, descriptive commits.
3. Ensure `pnpm lint` and `pnpm test` pass.
4. Open a PR with a description of what changed and why.

## Adding Skills

The easiest way to contribute is by adding YAML skills in the `skills/` directory. See `README.md > Custom Skills` for the format.

## Reporting Issues

Open a GitHub issue with:
- What you expected vs. what happened
- Steps to reproduce
- Your environment (OS, Node version)

## Code of Conduct

Be respectful. We're all here to build something useful.
