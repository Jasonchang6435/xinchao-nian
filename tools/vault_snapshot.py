#!/usr/bin/env python3
"""Offline full-directory snapshots. Restore only to a new, absent directory.

The operator must quiesce every writer before create. Change detection is a
second check, not a substitute for stopping writers or an atomic platform snapshot.
Includes credentials: keep both archive and receipt in private storage.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile

MANIFEST = 'snapshot-manifest.json'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def inventory(root):
    result = []
    for p in sorted(root.rglob('*')):
        s = p.lstat()
        if p.is_symlink() or not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)):
            raise ValueError('Snapshot refuses links and special files: ' + str(p.relative_to(root)))
        result.append({'path': p.relative_to(root).as_posix(), 'kind': 'dir' if p.is_dir() else 'file',
                       'mode': stat.S_IMODE(s.st_mode), 'size': s.st_size if p.is_file() else 0,
                       'sha256': digest(p) if p.is_file() else '',
                       'mtime_ns': s.st_mtime_ns})
    return result


def create(root, archive, quiesced):
    if not quiesced:
        raise ValueError('Stop every writer first, then explicitly pass --quiesced')
    root = Path(root).resolve(strict=True)
    archive = Path(archive).absolute()
    if not root.is_dir() or archive.resolve().is_relative_to(root):
        raise ValueError('Archive must be outside the source directory')
    if archive.exists():
        raise ValueError('Refusing to overwrite an existing archive')
    before = inventory(root)
    archive.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=archive.parent, prefix='.snapshot-', suffix='.tmp')
    os.close(fd)
    manifest = {'schema': 1, 'kind': 'full-offline-directory', 'quiesced': True, 'entries': before}
    try:
        with tarfile.open(temp, 'w:gz') as tf:
            for entry in before:
                tf.add(root / entry['path'], arcname='data/' + entry['path'], recursive=False)
            payload = json.dumps(manifest, ensure_ascii=False).encode()
            import io
            info = tarfile.TarInfo(MANIFEST)
            info.size = len(payload); info.mode = 0o600
            tf.addfile(info, io.BytesIO(payload))
        if inventory(root) != before:
            raise ValueError('Source changed during snapshot; discard and quiesce all writers')
        verify(temp)
        os.link(temp, archive)  # exclusive destination, never overwrite
        os.chmod(archive, 0o600)
        receipt = {'archiveSha256': digest(archive), 'fileCount': sum(e['kind'] == 'file' for e in before),
                   'bytes': sum(e['size'] for e in before)}
        receipt_path = Path(str(archive) + '.receipt.json')
        with receipt_path.open('x') as f:
            os.chmod(receipt_path, 0o600); json.dump(receipt, f, indent=2)
        return receipt
    finally:
        Path(temp).unlink(missing_ok=True)


def verify(archive, receipt=None):
    archive = Path(archive)
    if receipt and digest(archive) != json.loads(Path(receipt).read_text())['archiveSha256']:
        raise ValueError('Archive SHA-256 does not match the separate receipt')
    with tarfile.open(archive, 'r:gz') as tf:
        members = tf.getmembers()
        if len(members) > 200000:
            raise ValueError('Archive member count exceeds safety limit')
        names = set()
        for member in members:
            path = PurePosixPath(member.name)
            if (member.name in names or path.is_absolute() or '..' in path.parts
                    or '\\' in member.name or not (member.isfile() or member.isdir())):
                raise ValueError('Unsafe or duplicate archive member')
            if member.name != MANIFEST and (not member.name.startswith('data/') or len(path.parts) < 2):
                raise ValueError('Unexpected archive member')
            names.add(member.name)
        m = tf.getmember(MANIFEST)
        if m.size > 64 * 1024 * 1024:
            raise ValueError('Manifest too large')
        manifest = json.load(tf.extractfile(m))
        if manifest.get('schema') != 1 or manifest.get('kind') != 'full-offline-directory':
            raise ValueError('Unsupported manifest')
        expected = {MANIFEST}
        for e in manifest['entries']:
            path = PurePosixPath(e['path'])
            if not e['path'] or path.is_absolute() or '..' in path.parts or '\\' in e['path']:
                raise ValueError('Unsafe manifest path')
            name = 'data/' + e['path']
            if name in expected:
                raise ValueError('Duplicate manifest path')
            expected.add(name); member = tf.getmember(name)
            if e['kind'] == 'dir':
                if not member.isdir(): raise ValueError('Directory type mismatch')
            elif e['kind'] == 'file':
                if not member.isfile() or member.size != e['size']: raise ValueError('File size mismatch')
                h = hashlib.sha256()
                with tf.extractfile(member) as f:
                    for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
                if h.hexdigest() != e['sha256']: raise ValueError('File checksum mismatch: ' + e['path'])
            else:
                raise ValueError('Unsupported manifest entry')
        if names != expected:
            raise ValueError('Archive does not match manifest exactly')
        return manifest


def restore(archive, destination, receipt=None):
    manifest = verify(archive, receipt)
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError('Restore destination must be a new, absent directory')
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(dir=destination.parent, prefix='.restore-'))
    try:
        with tarfile.open(archive, 'r:gz') as tf:
            for e in manifest['entries']:
                p = stage / e['path']
                if e['kind'] == 'dir': p.mkdir(parents=True, exist_ok=True)
                else:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    with p.open('xb') as out, tf.extractfile('data/' + e['path']) as source:
                        shutil.copyfileobj(source, out)
                    os.chmod(p, e['mode'] & 0o777)  # never restore setuid bits
                    if digest(p) != e['sha256']: raise ValueError('Post-extraction checksum mismatch')
                    os.utime(p, ns=(e['mtime_ns'], e['mtime_ns']))
        # Restore directory modes last so read-only/private children remain writable during extraction.
        for e in reversed(manifest['entries']):
            if e['kind'] == 'dir':
                os.chmod(stage / e['path'], e['mode'] & 0o777)
                os.utime(stage / e['path'], ns=(e['mtime_ns'], e['mtime_ns']))
        if destination.exists(): raise ValueError('Destination appeared during restore')
        os.rename(stage, destination)
        return {'restored': True, 'fileCount': sum(e['kind'] == 'file' for e in manifest['entries'])}
    finally:
        if stage.exists(): shutil.rmtree(stage)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest='action', required=True)
    c = sub.add_parser('create'); c.add_argument('source'); c.add_argument('archive'); c.add_argument('--quiesced', action='store_true')
    v = sub.add_parser('verify'); v.add_argument('archive'); v.add_argument('--receipt')
    r = sub.add_parser('restore'); r.add_argument('archive'); r.add_argument('destination'); r.add_argument('--receipt')
    a = p.parse_args()
    try:
        if a.action == 'create': result = create(a.source, a.archive, a.quiesced)
        elif a.action == 'verify':
            m = verify(a.archive, a.receipt); result = {'verified': True, 'entries': len(m['entries'])}
        else: result = restore(a.archive, a.destination, a.receipt)
        print(json.dumps(result))
    except Exception as e:
        p.exit(1, type(e).__name__ + ': ' + str(e) + '\n')
