# OpenMoose Dev: 46elks Bridge

A multi-channel bridge for capturing SMS and Voice verification codes from your 46elks virtual number.

## Quick Start

1. **Install Dependencies**:
   ```bash
   python3 -m venv venv
   ./venv/bin/pip install -r tools/46elks-bridge/requirements.txt
   ```

2. **Setup Secrets**:
   Create a `tools/46elks-bridge/.env` file and add your `FORWARD_TO_NUMBER`.

3. **Start the Bridge**:
   ```bash
   ./venv/bin/python tools/46elks-bridge/elks_bridge.py
   ```

3. **Expose with Cloudflare**:
   ```bash
   cloudflared tunnel --url http://localhost:5000
   ```

4. **Update 46elks Dashboard**:
   Copy your Cloudflare URL (e.g., `https://...trycloudflare.com`) and paste it into your 46elks number settings for **SMS URL** and **Voice URL**.

## Configuration (elks_bridge.py)

- `FORWARD_TO_NUMBER`: Set this to your personal phone number (e.g., `+467...`) to hear calls live.
- `PRESS_DIGIT`: Set to `None` for manual touch-tone entry, or a digit (e.g., `'0'`) for auto-pressing.
- `RECORDING_LIMIT`: Backup recording length in seconds.

## WhatsApp Verification Strategy

1. **Wait for Cooldown**: If you see "Security Block" errors, wait a full 4-24 hours without trying.
2. **Use Voice**: Always prefer the "Call me" option.
3. **Manual Handover**: The bridge is configured by default to forward calls to your real phone so you can hear the random digits WhatsApp asks you to press.
4. **Backup**: If you miss the call, check the terminal for the `RECORDING_URL` link.

---
