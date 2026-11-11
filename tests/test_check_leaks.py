import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('check_leaks', Path(__file__).resolve().parents[1] / 'tools' / 'check_leaks.py')
check_leaks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check_leaks)

# Built piece by piece so that this file passes the check it tests.
WINDOWS_PATH = 'C:' + '/Users' + '/somebody/project/obj/file.cs'.replace('/', '\\')
UNIX_PATH = '/' + 'home/' + 'somebody/project'
ADDRESS = 'somebody' + '@' + 'mail.test.org'


class CheckLeaks(unittest.TestCase):
    def test_personal_paths_and_addresses_are_found(self):
        scan = lambda text: check_leaks.scan_content(text.encode('utf-8'), [])
        self.assertTrue(scan('built from ' + WINDOWS_PATH))
        self.assertTrue(scan('cd ' + UNIX_PATH))
        self.assertTrue(scan('contact: ' + ADDRESS))
        self.assertTrue(check_leaks.scan_content(WINDOWS_PATH.encode('utf-16-le'), []), 'UTF-16 text of a program')
        self.assertEqual(scan('C:' + '/Users' + '/<name>/AppData and https://example.org/home/page'), [])
        self.assertEqual(scan('Arizona <1+a' + '@' + 'users.noreply.github.com>'), [])

    def test_private_words(self):
        self.assertTrue(check_leaks.scan_content(b'path of MYPCNAME here', ['mypcname']))
        self.assertTrue(check_leaks.scan_content(b'on ABCD.', ['abcd']))
        self.assertEqual(check_leaks.scan_content(b'Abcdefgh', ['abcd']), [], 'short words match whole words only')

    def test_forbidden_paths(self):
        refused = lambda name: bool(check_leaks.scan_path(name, check_leaks.FORBIDDEN_IN_REPOSITORY))
        for name in ('app-src/obj/project.assets.json', 'config.json', 'assets/item.png', 'maps/Forest_1F.webp',
                     'build-next/stage/x', 'src/__pycache__/a.pyc', 'capture.jpg', 'dist/Navi-companion.zip'):
            self.assertTrue(refused(name), name)
        for name in ('src/server.py', 'maps/Zora_FairyFountain.webp', 'docs/map.jpg', 'config.example.json',
                     'app-src/Program.cs', 'tools/build.ps1'):
            self.assertFalse(refused(name), name)


if __name__ == '__main__':
    unittest.main()
