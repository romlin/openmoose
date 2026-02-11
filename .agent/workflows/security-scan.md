---
description: Run security scans using Trivy
---

This workflow runs security scans on the OpenMoose codebase and its Docker images using Trivy (locally installed).

### 1. Scan Filesystem (Package Dependencies)
// turbo
```bash
trivy fs --severity HIGH,CRITICAL .
```

### 2. Scan Sandbox Images
Scans the base images used for code execution.

// turbo
#### Python Sandbox
```bash
trivy image --severity HIGH,CRITICAL python:3.12-slim
```

// turbo
#### Node Sandbox
```bash
trivy image --severity HIGH,CRITICAL node:22-slim
```

// turbo
#### Custom Browser Daemon
```bash
trivy image --severity HIGH,CRITICAL openmoose-browser:1.58.0
```

### 3. Interpret Results
- **HIGH/CRITICAL**: Should be addressed immediately by updating the base image or dependency.
- **LOW/MEDIUM**: Can be monitored but are generally acceptable for sandboxed environments.
