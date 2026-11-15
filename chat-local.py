"""Run the website and its AI chat endpoint on the local machine."""

import json
import os
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PORT = 8000
HOSTS = {f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"}
MODEL = "gpt-6-luna"


def get_reply(bot, language, message, history, api_key):
    facts = "\n".join(entry["answer"] for entry in bot[language]["faqs"])
    instructions = (
        f"You are the website assistant for {bot['name']}. "
        "Answer questions about this business using only the business facts below. "
        "Use English or Spanish based on the visitor's message. "
        f"If the language is unclear, use {'Spanish' if language == 'es' else 'English'}. "
        "Keep replies brief and use plain text. When details are missing or "
        "the visitor wants a custom quote, refer them to the contact link below the chat. "
        "Never invent service details, guarantees, or prices.\n\nBusiness facts:\n"
        + facts
    )
    payload = {
        "model": MODEL,
        "instructions": instructions,
        "input": [*history, {"role": "user", "content": message}],
        "reasoning": {"effort": "none"},
        "max_output_tokens": 250,
        "store": False,
    }
    request = Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        data = json.load(response)
    return "\n".join(
        part["text"]
        for item in data.get("output", [])
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") == "output_text"
    ).strip()


class ChatHandler(SimpleHTTPRequestHandler):
    def send_json(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/chat":
            return self.send_json(404, {"error": "Unknown endpoint"})
        origin = self.headers.get("Origin")
        if origin not in HOSTS or origin != f"http://{self.headers.get('Host')}":
            return self.send_json(403, {"error": "Use the local website preview"})
        if self.headers.get_content_type() != "application/json":
            return self.send_json(415, {"error": "Expected JSON"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16_384:
                return self.send_json(413, {"error": "Invalid request size"})
            payload = json.loads(self.rfile.read(size))
            bot_id = payload["bot"]
            language = payload["language"]
            message = payload["message"].strip()
            history = payload.get("history", [])
            if not re.fullmatch(r"[a-z0-9-]{1,60}", bot_id):
                raise ValueError("Invalid bot ID")
            if language not in ("en", "es") or not 0 < len(message) <= 350:
                raise ValueError("Invalid language or message")
            if not isinstance(history, list) or len(history) > 4:
                raise ValueError("Invalid history")
            for entry in history:
                if entry["role"] not in ("user", "assistant") or not isinstance(entry["content"], str):
                    raise ValueError("Invalid history message")
                if len(entry["content"]) > 1200:
                    raise ValueError("History message too long")
            history = [{"role": entry["role"], "content": entry["content"]} for entry in history]
            bot = json.loads((ROOT / "assets" / "chat" / "bots" / f"{bot_id}.json").read_text(encoding="utf-8"))
        except FileNotFoundError:
            return self.send_json(404, {"error": "Unknown bot"})
        except (ValueError, TypeError, KeyError, AttributeError):
            return self.send_json(400, {"error": "Invalid chat request"})

        try:
            reply = get_reply(bot, language, message, history, os.environ["OPENAI_API_KEY"])
        except HTTPError as error:
            self.log_error("OpenAI API returned HTTP %s", error.code)
            return self.send_json(502, {"error": "Model request failed"})
        except (URLError, TimeoutError, ValueError):
            self.log_error("Could not read the OpenAI API response")
            return self.send_json(502, {"error": "Model request failed"})
        if not reply:
            return self.send_json(502, {"error": "Empty model response"})
        self.send_json(200, {"reply": reply})


if __name__ == "__main__":
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise SystemExit("Set OPENAI_API_KEY in this terminal before starting the chatbot.")
    handler = partial(ChatHandler, directory=ROOT)
    with ThreadingHTTPServer(("127.0.0.1", PORT), handler) as server:
        print(f"Chat preview running at http://localhost:{PORT}/", flush=True)
        server.serve_forever()
