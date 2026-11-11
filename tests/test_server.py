import unittest, struct, tempfile
from pathlib import Path
from unittest.mock import patch
import server

class Tests(unittest.TestCase):
    def test_reject_unknown_format(self):
        with self.assertRaises(ValueError): server.Save(bytes(64),64)
    def test_fields_and_bounds(self):
        raw=bytearray(80)
        struct.pack_into('<III',raw,0,0x01020304,0x002D80EB,56)
        struct.pack_into('<II',raw,40,123,56)
        struct.pack_into('<II',raw,48,456,23)
        raw[56:62]=b'Hello\0'
        save=server.Save(raw,56)
        self.assertEqual(save.string(123,6),'Hello')
        self.assertEqual(save.integer(456),23)
        with self.assertRaises(ValueError):save.block(123,25)
    def test_player_position_is_saved_vector(self):
        raw=bytearray(140)
        struct.pack_into('<III',raw,0,0x01020304,0x002D80EB,56)
        struct.pack_into('<IIII',raw,40,0xC884818D,56,0x1D6189DA,68)
        struct.pack_into('<fff',raw,56,50.25,104.0,-33.5)
        raw[68:81]=b'Market_Adult\0'
        save=server.Save(raw,56)
        self.assertEqual(server.player_position(save), {'area':'Market_Adult','position':[50.25,104.0,-33.5],'source':'save'})
        struct.pack_into('<f',raw,56,float('nan'))
        self.assertIsNone(server.player_position(save))
        struct.pack_into('<I',raw,44,139)
        self.assertIsNone(server.player_position(save))

    def test_duplicate_fields(self):
        raw=bytearray(56)
        struct.pack_into('<III',raw,0,0x01020304,0x002D80EB,56)
        struct.pack_into('<IIII',raw,40,123,0,123,0)
        with self.assertRaises(ValueError):server.Save(raw,56)
    def test_slot_traversal_rejected(self):
        with patch.object(server,'slots',return_value=[{'id':'slot_00','modified':1}]):
            with self.assertRaises(ValueError):server.snapshot('../../elsewhere')
    def test_save_root_from_config_then_nearby_install(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)/'Fritchii'/'Navi-companion';base.mkdir(parents=True)
            self.assertIsNone(server.find_save_root(base,{}))
            saves=Path(d)/'Fritchii'/'user'/'nand'/'user'/'save'/'0000000000000000'/'PROFILE'/server.TITLE_ID
            (saves/'slot_00').mkdir(parents=True);(saves/'slot_00'/'progress.sav').write_bytes(b'x')
            self.assertEqual(server.find_save_root(base,{}),saves)
            other=Path(d)/'elsewhere';other.mkdir()
            (base/'config.json').write_text('{"save_root": %s}' % __import__('json').dumps(str(other)),'utf-8')
            self.assertEqual(server.find_save_root(base,{}),other)
            (base/'config.json').write_text('{"save_root": "Z:/missing"}','utf-8')
            self.assertEqual(server.find_save_root(base,{}),saves)
    def test_missing_install_reports_setup_help(self):
        with patch.object(server,'ROOT',None):
            with self.assertRaisesRegex(ValueError,'config.example.json'):server.snapshot('latest')
    def test_static_image_names(self):
        self.assertTrue(server.STATIC_IMAGE.fullmatch('HyruleField_Adult_00.webp'))
        for name in ('C:foo.webp','a.webp:b.webp','../x.png','x.exe'):
            self.assertIsNone(server.STATIC_IMAGE.fullmatch(name))
    def test_unreadable_section_is_reported_unknown(self):
        def broken(save): raise ValueError('non reconnu')
        self.assertEqual(server.optional(broken,None,'inconnu'),'inconnu')
        self.assertEqual(server.optional(lambda save:7,None,'inconnu'),7)
        self.assertEqual(len(server.UNKNOWN_COLLECTIBLES['items']),len(server.COLLECTIBLES))
    def test_update_versions_and_archive_safety(self):
        import updater, zipfile
        self.assertGreater(updater.parse('v1.10.0'), updater.parse('1.9.3'))
        self.assertEqual(updater.parse('v2'), (2, 0, 0))
        with tempfile.TemporaryDirectory() as d:
            good=Path(d)/'good.zip'
            with zipfile.ZipFile(good,'w') as z: z.writestr('Navi-companion/VERSION','9.9.9')
            self.assertEqual((updater.safe_extract(good,Path(d)/'out')/'VERSION').read_text(),'9.9.9')
            for name in ('../evil.txt','Other/file.txt','Navi-companion/../../evil.txt'):
                bad=Path(d)/'bad.zip'
                with zipfile.ZipFile(bad,'w') as z: z.writestr(name,'x')
                with self.assertRaises(ValueError): updater.safe_extract(bad,Path(d)/'out2')
            (Path(d)/'config.json').write_text('{"check_updates": false}','utf-8')
            self.assertFalse(updater.enabled(Path(d)))
            idle=updater.Updater(Path(d),can_install=True); idle.start()
            self.assertEqual(idle.snapshot()['status'],'disabled')
            with self.assertRaises(ValueError): idle.install(lambda: None)
    def test_setup_progress_and_overlay_command(self):
        import download_images
        self.assertEqual(set(download_images.PROGRESS), {'total','done','failed','active'})
        with tempfile.TemporaryDirectory() as d:
            with patch.object(server,'BASE',Path(d)):
                self.assertIsNone(server.overlay_command())
                (Path(d)/'Navi.exe').write_bytes(b'')
                self.assertEqual(server.overlay_command(),[str(Path(d)/'Navi.exe'),'--overlay'])
    def test_update_removes_files_of_older_layouts(self):
        with tempfile.TemporaryDirectory() as d:
            base=Path(d)
            for name in ('app.js','server.py','config.json','VERSION'): (base/name).write_text('x','utf-8')
            for name in ('fonts','assets','web'): (base/name).mkdir(); (base/name/'file').write_text('x','utf-8')
            server.remove_legacy_files(base)
            self.assertEqual(sorted(p.name for p in base.iterdir()),['VERSION','assets','config.json','web'])
            self.assertTrue((base/'assets'/'file').is_file())
    def test_stable_read_leaves_file_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'test.sav';p.write_bytes(b'unchanged')
            before=p.stat().st_mtime_ns
            self.assertEqual(server.stable_read(p),b'unchanged')
            self.assertEqual(p.stat().st_mtime_ns,before)

if __name__=='__main__':unittest.main()
