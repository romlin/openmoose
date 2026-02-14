import os
import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from dotenv import load_dotenv

# Load configuration from .env file
load_dotenv()

# --- CONFIGURATION ---
PRESS_DIGIT = os.getenv('PRESS_DIGIT', '0')
RECORDING_LIMIT = int(os.getenv('RECORDING_LIMIT', '60'))
FORWARD_TO_NUMBER = os.getenv('FORWARD_TO_NUMBER')
VIRTUAL_NUMBER = os.getenv('VIRTUAL_NUMBER', 'Unknown')
# ---------------------

class ElksBridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default server logs for a cleaner CLI
        return

    def _send_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def _send_ok(self):
        self.send_response(200)
        self.send_header('Content-type', 'text/plain')
        self.end_headers()
        self.wfile.write(b"OK")

    def _handle_voice(self, params):
        print("\n" + "-"*20)
        print("INCOMING VOICE CALL DETECTED")
        print(f"From: {params.get('from', ['?'])[0]}")

        if 'recording_url' in params:
            print(f"RECORDING FINISHED: {params.get('recording_url', [''])[0]}")
            print("Open that URL in your browser to hear the code!")
            self._send_ok()
        else:
            print("Initiating Bridge Sequence...")
            
            # 1. Background recording
            host = self.headers.get('Host', 'localhost:5000')
            callback = f"https://{host}"
            instructions = {"recordcall": callback}

            # 2. Add Auto-Press or Forwarding
            if PRESS_DIGIT:
                print(f"Auto-pressing '{PRESS_DIGIT}' (5s delay)...")
                instructions["play"] = f"sound/dtmf/PPPPPPPPPP{PRESS_DIGIT}"
                instructions["next"] = {"connect": FORWARD_TO_NUMBER} if FORWARD_TO_NUMBER else {"record": callback, "timelimit": RECORDING_LIMIT}
            elif FORWARD_TO_NUMBER:
                print(f"Forwarding to {FORWARD_TO_NUMBER}...")
                instructions["connect"] = FORWARD_TO_NUMBER
            else:
                instructions["record"] = callback
                instructions["timelimit"] = RECORDING_LIMIT

            self._send_json(instructions)
        print("-"*20 + "\n")

    def _handle_sms(self, params):
        sms_from = params.get('from', ['Unknown'])[0]
        sms_msg = params.get('message', [''])[0]
        
        print("\n" + "="*40)
        print("NEW INCOMING SMS")
        print(f"From:    {sms_from}")
        print(f"Message: {sms_msg}")
        print("="*40 + "\n")
        self._send_ok()

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length).decode('utf-8')
        params = urllib.parse.parse_qs(post_data)

        if 'callid' in params:
            self._handle_voice(params)
        else:
            self._handle_sms(params)

def run(server_class=HTTPServer, handler_class=ElksBridgeHandler, port=5000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f"Elks Bridge active on port {port}...")
    print(f"Listening for SMS & Voice on: {VIRTUAL_NUMBER}")
    print("Tip: Expose this via 'cloudflared tunnel --url http://localhost:5000'")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Elks Bridge...")
        httpd.server_close()

if __name__ == '__main__':
    run()
