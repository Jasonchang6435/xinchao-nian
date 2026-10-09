"""Validate official OB3.2 online export and restore raw logical files to a NEW lab vault.

Run inside the fixed OB3.2 image. Does not call a model or touch an existing vault.
Config, OAuth, media and service state are NOT members of a logical export.
"""
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
sys.path.insert(0, '/app/src')
from ombrebrain.storage.backup_archive import read_backup_archive, _validate_source_reference_closure, validate_sqlite_bytes

def restore(archive, destination):
    payload = Path(archive).read_bytes()
    backup = read_backup_archive(payload)
    if not backup['integrity_verified']: raise ValueError('Manifest required for this recovery drill')
    files = backup['files']; _validate_source_reference_closure(files)
    validate_sqlite_bytes(files.get('embeddings.db', b''))
    root = Path(destination); root.mkdir(mode=0o700)  # no exist_ok: never overwrite a vault
    hashes = {}
    for name, data in files.items():
        if name.startswith('buckets/') and name.endswith('.md'): rel = name[len('buckets/'):]
        elif name.startswith('sources/') and name.endswith('.source'):
            rel = '_sources/' + name[len('sources/'):]
            if Path(name).stem != 'src_' + hashlib.sha256(data).hexdigest(): raise ValueError('Source content address mismatch')
        elif name == 'embeddings.db': rel = name
        elif name == 'export_meta.json': continue
        else: raise ValueError('Unexpected logical member ' + name)
        target = root/rel
        if not target.resolve().is_relative_to(root.resolve()): raise ValueError('Unsafe destination')
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        target.write_bytes(data); target.chmod(0o600)
        if target.read_bytes() != data: raise ValueError('Restored bytes differ')
        hashes[rel] = hashlib.sha256(data).hexdigest()
    if (root/'embeddings.db').exists():
        with sqlite3.connect(str(root/'embeddings.db')) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': raise ValueError('SQLite integrity failed')
    print(json.dumps({'archiveSha256':hashlib.sha256(payload).hexdigest(), 'manifestVerified':True,
                      'sourceClosureVerified':True, 'rawFilesIdentical':True, 'restoredFiles':len(hashes),
                      'sqliteIntegrity':'ok' if 'embeddings.db' in hashes else 'not_exported',
                      'excludes':['config','OAuth','_media','heart-state']}))

if __name__ == '__main__': restore(*sys.argv[1:])
