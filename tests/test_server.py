"""Testes do servidor. Rode com: python -m unittest discover tests"""

import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.httpd = server.make_server("127.0.0.1", 0, self.data)
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.tmp.cleanup()

    def call(self, path, payload=None):
        request = urllib.request.Request(self.base + path, method="PUT" if payload is not None else "GET")
        body = json.dumps(payload).encode() if payload is not None else None
        try:
            with urllib.request.urlopen(request, body) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    def test_starts_empty_and_saves(self):
        self.assertEqual(self.call("/api/state"), (200, {"rev": 0, "state": None}))
        status, body = self.call("/api/state", {"baseRev": 0, "state": {"entries": [], "people": ["a"]}})
        self.assertEqual((status, body), (200, {"rev": 1}))
        self.assertEqual(self.call("/api/state")[1]["state"]["people"], ["a"])
        self.assertEqual(json.loads((self.data / "state.json").read_text(encoding="utf-8"))["rev"], 1)

    def test_stale_write_is_rejected(self):
        self.call("/api/state", {"baseRev": 0, "state": {"entries": [1]}})
        status, body = self.call("/api/state", {"baseRev": 0, "state": {"entries": [2]}})
        self.assertEqual((status, body), (409, {"rev": 1}))
        self.assertEqual(self.call("/api/state")[1]["state"]["entries"], [1])

    def test_invalid_state_is_rejected(self):
        self.assertEqual(self.call("/api/state", {"baseRev": 0, "state": "oops"})[0], 400)
        self.assertEqual(self.call("/api/state", {"state": {"entries": []}})[0], 400)

    def test_serves_only_the_app_folder(self):
        with urllib.request.urlopen(self.base + "/") as response:
            self.assertIn("Monetizeo", response.read().decode())
            self.assertEqual(response.headers["Cache-Control"], "no-cache")
        for path in ("/../server.py", "/data/state.json", "/..%2fdata%2fstate.json"):
            with self.assertRaises(urllib.error.HTTPError):
                urllib.request.urlopen(self.base + path)

    def test_daily_backup_keeps_previous_version(self):
        self.call("/api/state", {"baseRev": 0, "state": {"entries": [1]}})
        self.call("/api/state", {"baseRev": 1, "state": {"entries": [2]}})
        backups = list((self.data / "backups").glob("state-*.json"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text(encoding="utf-8"))["state"]["entries"], [1])

    def test_access_code_guards_other_devices(self):
        server.Handler.code = "123456"
        original = server.LOOPBACK
        server.LOOPBACK = set()  # finge que o pedido vem de outro aparelho
        try:
            self.assertEqual(self.call("/api/state")[0], 401)
            request = urllib.request.Request(self.base + "/api/state", headers={"X-Monetizeo-Code": "123456"})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(response.status, 200)
        finally:
            server.LOOPBACK = original
            server.Handler.code = None


if __name__ == "__main__":
    unittest.main()
