# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in OpenMoose, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Email the maintainers directly or use GitHub's private vulnerability reporting feature.
3. Include a description of the vulnerability, steps to reproduce, and potential impact.

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days.

## Security Architecture

OpenMoose uses defense-in-depth for code execution:

- **Docker sandbox** -- All user-initiated code runs in disposable containers
- **Read-only root filesystem** (`--read-only`)
- **All capabilities dropped** (`--cap-drop ALL`)
- **Non-root user** (`--user 1000:1000`)
- **Resource limits** (memory, CPU, timeout)
- **Path validation** -- File tools are restricted to the project directory

## Known Considerations

- **WhatsApp credentials** are stored locally in `.moose/data/whatsapp-auth/`. This directory is gitignored but should be protected on your machine.
- **API keys** (Mistral) are loaded from `.env` which is gitignored. Never commit `.env`.
- **YAML skills** with `host: true` execute directly on your machine. Only use trusted skills with this flag.

## Supported Versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |
