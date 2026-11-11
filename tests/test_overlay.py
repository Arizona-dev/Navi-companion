import http.client
import json
import threading
import unittest
from unittest.mock import patch
import server


class OverlayTests(unittest.TestCase):
    def test_local_browser_can_open_only_fixed_overlay_program(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection('127.0.0.1', httpd.server_port)
        host = f'127.0.0.1:{httpd.server_port}'
        try:
            fixed = ['C:/Navi/Navi.exe', '--overlay']
            with patch.object(server.subprocess, 'Popen') as start, patch.object(server, 'overlay_command', return_value=fixed):
                connection.request('POST', '/api/overlay/open', '{"program": "evil.exe"}', {'Origin': 'http://' + host, 'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {'opened': True})
                self.assertEqual(start.call_args.args[0], fixed)
        finally:
            connection.close(); httpd.shutdown(); httpd.server_close()

    def test_foreign_origin_cannot_open_window(self):
        httpd = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        connection = http.client.HTTPConnection('127.0.0.1', httpd.server_port)
        try:
            with patch.object(server.subprocess, 'Popen') as start:
                connection.request('POST', '/api/overlay/open', '{}', {'Origin': 'https://unrelated.example', 'Content-Type': 'application/json'})
                response = connection.getresponse()
                self.assertEqual(response.status, 403)
                response.read()
                start.assert_not_called()
        finally:
            connection.close(); httpd.shutdown(); httpd.server_close()
