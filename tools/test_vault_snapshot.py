import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

from vault_snapshot import create, verify, restore


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name);self.source=self.root/'source';self.source.mkdir()
        for name, payload in [('dynamic/memory.md', b'raw memory'), ('_sources/src_evidence.source', b'original source'),
                              ('_media/photo.png', b'media bytes'), ('config.yaml', b'config'),
                              ('.dashboard_mcp_tokens.json', b'private test grant'), ('_app/VERSION', b'3.2.0')]:
            path=self.source/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(payload)
        with sqlite3.connect(self.source/'embeddings.db') as c:
            c.execute('CREATE TABLE sample(id TEXT)');c.execute('INSERT INTO sample VALUES (?)', ('memory',))
        self.archive=self.root/'backup.tar.gz'

    def test_full_directory_roundtrip_and_baseline_recovery(self):
        create(self.source,self.archive,True)
        self.assertTrue(verify(self.archive,str(self.archive)+'.receipt.json'))
        (self.source/'dynamic/memory.md').write_bytes(b'after backup change')
        destination=self.root/'restored';restore(self.archive,destination,str(self.archive)+'.receipt.json')
        self.assertEqual((destination/'dynamic/memory.md').read_bytes(),b'raw memory')
        self.assertEqual((destination/'_sources/src_evidence.source').read_bytes(),b'original source')
        self.assertEqual((destination/'_media/photo.png').read_bytes(),b'media bytes')
        self.assertEqual((destination/'.dashboard_mcp_tokens.json').read_bytes(),b'private test grant')
        self.assertEqual((destination/'_app/VERSION').read_bytes(),b'3.2.0')
        with sqlite3.connect(destination/'embeddings.db') as c:
            self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(c.execute('SELECT id FROM sample').fetchone()[0],'memory')

    def test_requires_quiescence_and_archive_outside_source(self):
        with self.assertRaises(ValueError):create(self.source,self.archive,False)
        with self.assertRaises(ValueError):create(self.source,self.source/'backup.tar.gz',True)

    def test_existing_restore_destination_never_overwritten(self):
        create(self.source,self.archive,True)
        with self.assertRaises(ValueError):restore(self.archive,self.source)
        self.assertEqual((self.source/'dynamic/memory.md').read_bytes(),b'raw memory')

    def test_symlink_source_refused(self):
        (self.source/'escape').symlink_to(self.root)
        with self.assertRaises(ValueError):create(self.source,self.archive,True)
        self.assertFalse(self.archive.exists())

    def tampered(self, change):
        create(self.source,self.archive,True)
        bad=self.root/'tampered.tar.gz'
        with tarfile.open(self.archive,'r:gz') as source,tarfile.open(bad,'w:gz') as target:
            for member in source.getmembers():
                payload=source.extractfile(member).read() if member.isfile() else None
                member,payload=change(member,payload)
                if member is None:continue
                if payload is not None:member.size=len(payload)
                target.addfile(member,io.BytesIO(payload) if payload is not None else None)
        return bad

    def test_content_corruption_rejected_before_restore(self):
        bad=self.tampered(lambda m,p:(m,b'bad memory' if m.name=='data/dynamic/memory.md' else p))
        with self.assertRaises(ValueError):restore(bad,self.root/'must-not-exist')
        self.assertFalse((self.root/'must-not-exist').exists())

    def test_missing_source_member_rejected(self):
        bad=self.tampered(lambda m,p:(None,None) if m.name.startswith('data/_sources/') and m.isfile() else (m,p))
        with self.assertRaises((ValueError,KeyError)):verify(bad)

    def test_traversal_and_receipt_mismatch_rejected(self):
        def edit(m,p):
            if m.name=='data/dynamic/memory.md':m.name='data/../../outside'
            return m,p
        bad=self.tampered(edit)
        with self.assertRaises(ValueError):verify(bad)
        with self.assertRaises(ValueError):verify(bad,str(self.archive)+'.receipt.json')


if __name__=='__main__':unittest.main()
