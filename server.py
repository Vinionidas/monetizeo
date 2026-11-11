"""Servidor do Monetizeo: entrega o app e guarda os dados num único arquivo.

    python server.py            só neste computador  (http://127.0.0.1:8765)
    python server.py --lan      também para celulares na mesma rede Wi-Fi

Sem dependências além do Python 3.9+. Os dados ficam em data/state.json, com
uma cópia por dia em data/backups/. Com --lan, quem acessa de outro aparelho
precisa digitar o código de acesso mostrado ao iniciar (data/codigo.txt).
"""

from __future__ import annotations

import argparse
import datetime as dt
import hmac
import json
import os
import secrets
import socket
import sys
import threading
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
APP_DIR = ROOT / "app"
MAX_BODY = 8 * 1024 * 1024
BACKUPS_TO_KEEP = 60
LOOPBACK = {"127.0.0.1", "::1", "::ffff:127.0.0.1"}


class Store:
    """Estado do casal em disco, com número de revisão para detectar edição simultânea."""

    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.file = data_dir / "state.json"
        self.backups = data_dir / "backups"
        self.lock = threading.Lock()
        self.backups.mkdir(parents=True, exist_ok=True)
        self.rev, self.state = 0, None
        if self.file.exists():
            saved = json.loads(self.file.read_text(encoding="utf-8"))
            self.rev, self.state = int(saved.get("rev", 0)), saved.get("state")

    def read(self):
        with self.lock:
            return {"rev": self.rev, "state": self.state}

    def write(self, base_rev: int, state) -> tuple[bool, int]:
        """Grava se ninguém alterou desde `base_rev`. Devolve (gravou, revisão atual)."""
        with self.lock:
            if base_rev != self.rev:
                return False, self.rev
            self._backup_once_a_day()
            self.rev += 1
            self.state = state
            temp = self.file.with_suffix(".tmp")
            temp.write_text(json.dumps({"rev": self.rev, "state": state}, ensure_ascii=False), encoding="utf-8")
            os.replace(temp, self.file)  # troca atômica: nunca fica um arquivo pela metade
            return True, self.rev

    def _backup_once_a_day(self):
        if not self.file.exists():
            return
        target = self.backups / f"state-{dt.date.today().isoformat()}.json"
        if target.exists():
            return
        target.write_bytes(self.file.read_bytes())
        for old in sorted(self.backups.glob("state-*.json"))[:-BACKUPS_TO_KEEP]:
            old.unlink(missing_ok=True)


def access_code(data_dir: Path) -> str:
    path = data_dir / "codigo.txt"
    if path.exists() and path.read_text(encoding="utf-8").strip():
        return path.read_text(encoding="utf-8").strip()
    code = f"{secrets.randbelow(10**6):06d}"
    path.write_text(code, encoding="utf-8")
    return code


class Handler(SimpleHTTPRequestHandler):
    server_version = "Monetizeo"
    store: Store
    code: str | None = None

    def end_headers(self):
        # O navegador sempre confere se o arquivo mudou: nada de versão velha presa em cache.
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/") and "PUT" not in (self.command or ""):
            return
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, status: int, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _allowed(self) -> bool:
        if self.code is None or self.client_address[0] in LOOPBACK:
            return True
        given = self.headers.get("X-Monetizeo-Code", "")
        return hmac.compare_digest(given.encode(), self.code.encode())

    def do_GET(self):
        route = self.path.split("?", 1)[0]
        if not route.startswith("/api/"):
            return super().do_GET()
        if not self._allowed():
            return self._json(HTTPStatus.UNAUTHORIZED, {"error": "codigo"})
        if route == "/api/state":
            return self._json(HTTPStatus.OK, self.store.read())
        if route == "/api/rev":
            return self._json(HTTPStatus.OK, {"rev": self.store.rev})
        return self._json(HTTPStatus.NOT_FOUND, {"error": "rota"})

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/state":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "rota"})
        if not self._allowed():
            return self._json(HTTPStatus.UNAUTHORIZED, {"error": "codigo"})
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            return self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "tamanho"})
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            base_rev, state = int(payload["baseRev"]), payload["state"]
            if not isinstance(state, dict) or not isinstance(state.get("entries"), list):
                raise ValueError("estado inválido")
        except (ValueError, KeyError, TypeError):
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "formato"})
        saved, rev = self.store.write(base_rev, state)
        return self._json(HTTPStatus.OK if saved else HTTPStatus.CONFLICT, {"rev": rev})


def lan_address() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))  # não envia nada; só descobre a interface de saída
            return probe.getsockname()[0]
    except OSError:
        return None


def make_server(host: str, port: int, data_dir: Path, code: str | None = None) -> ThreadingHTTPServer:
    handler = partial(Handler, directory=str(APP_DIR))
    Handler.store = Store(data_dir)
    Handler.code = code
    return ThreadingHTTPServer((host, port), handler)


def main():
    parser = argparse.ArgumentParser(description="Servidor local do Monetizeo")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--lan", action="store_true", help="permite acesso de outros aparelhos na rede de casa")
    parser.add_argument("--data", type=Path, default=ROOT / "data", help="pasta dos dados")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    args.data.mkdir(parents=True, exist_ok=True)
    code = access_code(args.data) if args.lan else None
    server = make_server("0.0.0.0" if args.lan else "127.0.0.1", args.port, args.data, code)

    print(f"Monetizeo rodando.\n  Neste computador: http://127.0.0.1:{args.port}")
    if args.lan:
        address = lan_address()
        print(f"  No celular (mesmo Wi-Fi): http://{address or 'IP-deste-computador'}:{args.port}")
        print(f"  Código de acesso: {code}")
    print("Para encerrar, feche esta janela ou aperte Ctrl+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
