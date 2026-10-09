#!/usr/bin/env python3
"""Real OB3.2 + heart Docker laboratory with synthetic data only.

Requires images already built from the recorded fixed sources. No published
ports, an internal network, new directories, and no access to production OB.
Keeps private backups/evidence; removes only containers/network created here.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import shutil

ROOT = Path(__file__).resolve().parents[2]
DOCKER = os.environ.get('DOCKER', '/usr/local/bin/docker')


def command(*args, check=True):
    r = subprocess.run(args, text=True, capture_output=True)
    if check and r.returncode:
        raise RuntimeError('Command failed: ' + ' '.join(args[:4]) + '\n' + r.stderr[-1800:] + r.stdout[-1800:])
    return r.stdout.strip()


def docker(*args, **kw): return command(DOCKER, *args, **kw)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--ob-image', default='xinchao-risk-ob32:6f7335d')
    p.add_argument('--heart-image', default='xinchao-external-ob:dev')
    p.add_argument('--output', required=True)
    p.add_argument('--legacy', action='store_true', help='Run vendored OB2.6.5 behavior baseline with the same verified dependency image')
    a = p.parse_args()
    out = Path(a.output).absolute()
    if out.exists(): raise ValueError('Use a NEW output directory for every full run')
    out.mkdir(mode=0o700)
    for folder in ['cert', 'ob-vault', 'heart-state', 'snapshots']: (out/folder).mkdir(mode=0o700)
    command('openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
            '-keyout', str(out/'cert/server.key'), '-out', str(out/'cert/server.crt'),
            '-subj', '/CN=ob.lab.test', '-addext', 'subjectAltName=DNS:ob.lab.test',
            '-addext', 'basicConstraints=critical,CA:TRUE')
    os.chmod(out/'cert/server.key', 0o600)
    os.chmod(out/'cert', 0o755)  # public CA readable by UID1000; private key remains 0600
    prefix = 'xn-risk-' + secrets.token_hex(5)
    names = {key: prefix+'-'+key for key in ['ob', 'heart', 'provider']}
    network = prefix+'-net'
    password = secrets.token_hex(24)
    obconfig = {
        'transport': 'streamable-http', 'trusted_proxy_cidrs': ['172.16.0.0/12'], 'deployment': {'public_url': 'https://ob.lab.test'},
        'mcp_require_auth': True, 'mcp_auth_mode': 'oauth', 'timezone': 'Asia/Shanghai',
        'storage': {'external_change_poll_seconds': 0},
        'dehydration': {'model': 'lab-model', 'base_url': 'http://provider:8001/v1', 'api_key': 'lab-only', 'timeout_seconds': 2},
        'embedding': {'enabled': True, 'background_indexing': True, 'model': 'lab-embedding',
                      'base_url': 'http://provider:8001/v1', 'api_key': 'lab-only', 'dim': 32, 'format': 'openai_compat'},
        'decay': {'check_interval_hours': 10000}, 'merge_threshold': 75,
        'surfacing': {'breath_max_tokens': 10000, 'breath_max_results': 20},
        'github_sync': {'enabled': False},
    }
    (out/'ob-vault/config.yaml').write_text(json.dumps(obconfig))
    source = '历史原始谈话\n原话：我一直记得。'
    ref = 'src_' + hashlib.sha256(source.encode()).hexdigest()
    (out/'ob-vault/_sources').mkdir(); (out/f'ob-vault/_sources/{ref}.source').write_text(source)
    history = [
        ('010101010101', 'permanent', '历史核心：雨天的约定。\n原话：我一直记得。\n[[保留链接]]',
         {'pinned': True, 'domain': ['恋爱'], 'importance': 10, 'source_refs': [{'ref': ref, 'ranges': [[1,2]]}], 'quotes': [{'text': '我一直记得。'}]}),
        ('020202020202', 'i', '历史正式自我认知，原文保持不变。', {'tags': ['__i__', 'aspect:patterns'], 'dont_surface': True}),
        ('030303030303', 'letter', '历史人类锁信，AI不可读取。',
         {'tags': ['__letter__'], 'author': 'user', 'locked_by': 'human', 'lock_type': 'permanent'}),
    ]
    for ident, kind, text, extras in history:
        folder = {'i': 'dynamic', 'letter': 'letters'}.get(kind, kind)
        d = out/'ob-vault'/folder; d.mkdir(exist_ok=True)
        meta = {'id': ident, 'type': kind, 'name': '历史'+kind, 'domain': ['测试'], 'created': '2024-01-01T12:00:00',
                'last_active': '2026-10-09T12:00:00', 'importance': 5, 'valence': .5, 'arousal': .3, **extras}
        (d/f'history_{ident}.md').write_text('---\n'+json.dumps(meta,ensure_ascii=False)+'\n---\n'+text+'\n')
    (out/'ob-vault/_media').mkdir()
    (out/'ob-vault/_media/history.png').write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOioAAAAASUVORK5CYII='))
    env = {
        'DRYRUN': 'true', 'PORT': '18110', 'SERVICE_TOKEN': secrets.token_hex(32), 'SHADOW_MODE': 'false',
        'MCP_ENABLED': 'true', 'OAUTH_ENABLED': 'true', 'OAUTH_PUBLIC_BASE_URL': 'https://heart.lab.test',
        'OAUTH_APPROVAL_TOKEN': secrets.token_hex(32), 'DASHBOARD_ENABLED': 'true',
        'DASHBOARD_ACCESS_TOKEN': secrets.token_hex(32), 'DASHBOARD_PUBLIC_BASE_URL': 'https://heart.lab.test',
        'OMBRE_ADAPTER': 'native' if a.legacy else 'ob32', 'OMBRE_MCP_URL': 'https://ob.lab.test/mcp', 'OMBRE_MCP_EXTRA_URL': 'https://ob.lab.test/mcp' if a.legacy else 'https://ob.lab.test/mcp-extra',
        'OMBRE_AUTH_MODE': 'oauth', 'OMBRE_READ_ENABLED': 'true', 'OMBRE_WRITE_ENABLED': 'true',
        'OMBRE_DREAM_WRITE_ENABLED': 'false', 'OMBRE_ALLOW_DESTRUCTIVE_WRITES': 'false',
        'OMBRE_DASHBOARD_BASE_URL': 'https://ob.lab.test', 'OMBRE_DASHBOARD_PASSWORD': password,
        'LAB_OB_PASSWORD': password, 'NODE_EXTRA_CA_CERTS': '/cert/server.crt',
        'MODEL_ENABLED': 'false', 'DAYTIME_EMERGENCE_ENABLED': 'false', 'DREAM_ENABLED': 'false',
        'BARK_ENABLED': 'false', 'BRIDGE_ENABLED': 'false', 'ATTENTION_ENABLED': 'false', 'SETTLE_INTERVAL_MINUTES': '1440',
    }
    env = {('OMBRE_TEST_' + k[len('OMBRE_'):] if k.startswith('OMBRE_') and k not in ['OMBRE_ADAPTER', 'OMBRE_READ_ENABLED'] else k): v for k, v in env.items()}
    env['OMBRE_TEST_WRITE_ENABLED'] = 'false'
    envpath=out/'heart.env';envpath.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n');os.chmod(envpath,0o600)
    evidence = {'obImage': a.ob_image, 'heartImage': a.heart_image, 'productionContacted': False,
                'legacySourceBaseline': a.legacy, 'heartScenarioUid': 1000,
                'modelProvider': 'deterministic local fixture, not a real model quality benchmark', 'rounds': []}
    current_ob=out/'ob-vault';current_heart=out/'heart-state'

    def start_ob():
        docker('run','-d','--name',names['ob'],'--network',network,'--network-alias','ob',
               '--mount',f'type=bind,source={current_ob},target=/app/buckets',
               '-e','OMBRE_MCP_AUTH_MODE=oauth','-e','OMBRE_MCP_REQUIRE_AUTH=true',
               '-e','OMBRE_TRUSTED_PROXY_CIDRS=172.16.0.0/12',
               '-e','OMBRE_DASHBOARD_PASSWORD='+password,'-e','OMBRE_COMPRESS_API_KEY=lab-only',
               '-e','OMBRE_EMBED_API_KEY=lab-only','-e','OMBRE_EMBED_FORMAT=openai_compat',a.ob_image)

    def start_heart():
        docker('run','-d','--name',names['heart'],'--network',network,
               '--env-file',str(envpath),'--mount',f'type=bind,source={current_heart},target=/app/state',
               '--mount',f'type=bind,source={out}/cert,target=/cert,readonly',
               '--mount',f'type=bind,source={ROOT}/tools/lab,target=/lab,readonly',a.heart_image)

    def ready():
        script="Promise.all([fetch('http://127.0.0.1:18110/health'),fetch('https://ob.lab.test/api/version')]).then(rs=>process.exit(rs.every(r=>r.ok)?0:1)).catch(()=>process.exit(1))"
        for _ in range(45):
            r=subprocess.run([DOCKER,'exec',names['heart'],'node','-e',script],capture_output=True)
            if not r.returncode: return
            time.sleep(.5)
        raise RuntimeError('Container startup did not become healthy')

    def scenario(stage, *args):
        raw=docker('exec','--user','1000:1000',names['heart'],'node','/lab/scenarios.mjs',stage,*map(str,args))
        data=json.loads(raw.splitlines()[-1]); evidence['rounds'].append(data)
        (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
        print(json.dumps({'stage':stage,'checksPassed':len(data['checks'])}),flush=True)

    def snapshot(source, stem):
        # Called only after BOTH real services stop. Mount source read-only.
        docker('run','--rm','--network','none','--entrypoint','python',
               '--mount',f'type=bind,source={ROOT}/tools,target=/tools,readonly',
               '--mount',f'type=bind,source={source},target=/source,readonly',
               '--mount',f'type=bind,source={out},target=/out',a.ob_image,
               '/tools/vault_snapshot.py','create','/source',f'/out/snapshots/{stem}.tar.gz','--quiesced')

    def verify_sqlite(folder):
        # Check independent restored files before any OB startup can modify them.
        raw=docker('run','--rm','--network','none','--entrypoint','python',
                   '--mount',f'type=bind,source={out/folder},target=/vault,readonly',a.ob_image,
                   '-c', "import pathlib,sqlite3,json; paths=list(pathlib.Path('/vault').rglob('*.db')); results={str(p.relative_to('/vault')):sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True).execute('PRAGMA integrity_check').fetchone()[0] for p in paths}; assert all(v=='ok' for v in results.values()); print(json.dumps(results))")
        evidence.setdefault('restoredSqliteChecks',{})[folder]=json.loads(raw.splitlines()[-1])

    def restore(stem, folder):
        docker('run','--rm','--network','none','--entrypoint','python',
               '--mount',f'type=bind,source={ROOT}/tools,target=/tools,readonly',
               '--mount',f'type=bind,source={out},target=/out',a.ob_image,
               '/tools/vault_snapshot.py','restore',f'/out/snapshots/{stem}.tar.gz',f'/out/{folder}',
               '--receipt',f'/out/snapshots/{stem}.tar.gz.receipt.json')

    try:
        docker('network','create','--internal',network)
        docker('run','-d','--name',names['provider'],'--network',network,'--network-alias','provider','--network-alias','ob.lab.test',
               '--mount',f'type=bind,source={out}/ob-vault,target=/ob-vault,readonly',
               '--mount',f'type=bind,source={out}/cert,target=/cert,readonly',
               '--mount',f'type=bind,source={ROOT}/tools/lab,target=/lab,readonly',
               '--entrypoint','python',a.ob_image,'/lab/provider.py')
        start_ob();start_heart();ready();scenario('prepare');scenario('verify-readonly')
        env['OMBRE_TEST_WRITE_ENABLED']='true'
        envpath.write_text('\n'.join(k+'='+v for k,v in env.items())+'\n')
        docker('rm','-f',names['heart']);start_heart();ready()
        docker('stop',names['heart'],names['ob']);snapshot(current_ob,'baseline-ob');snapshot(current_heart,'baseline-heart')
        docker('start',names['ob'],names['heart']);ready()
        for n in range(1,2 if a.legacy else 4):
            scenario('legacy-round' if a.legacy else 'round',n)
            if n == 2:
                docker('kill',names['ob'],names['heart']);docker('start',names['ob'],names['heart'])
                evidence['abruptRestartTested']=True
            else: docker('restart',names['ob'],names['heart'])
            ready()
        if not a.legacy: scenario('online-export')
        docker('stop',names['heart'],names['ob']);snapshot(current_ob,'after-ob');snapshot(current_heart,'after-heart')
        restore('after-ob','restored-ob');restore('after-heart','restored-heart');verify_sqlite('restored-ob')
        docker('rm',names['heart'],names['ob']);current_ob=out/'restored-ob';current_heart=out/'restored-heart'
        start_ob();start_heart();ready();scenario('verify-restored')
        docker('stop',names['heart'],names['ob'])
        if not a.legacy:
            raw=docker('run','--rm','--network','none','--entrypoint','python',
                       '--mount',f'type=bind,source={ROOT}/tools/lab,target=/lab,readonly',
                       '--mount',f'type=bind,source={out},target=/out',a.ob_image,
                       '/lab/logical_restore.py','/out/heart-state/lab-online-export.zip','/out/logical-ob')
            evidence['onlineLogicalRecovery']=json.loads(raw.splitlines()[-1])
            (out/'logical-ob/config.yaml').write_text(json.dumps(obconfig))
            (out/'logical-heart').mkdir(mode=0o700)
            shutil.copyfile(out/'heart-state/lab-export-count.json', out/'logical-heart/lab-export-count.json')
            docker('rm',names['heart'],names['ob']);current_ob=out/'logical-ob';current_heart=out/'logical-heart'
            start_ob();start_heart();ready();scenario('prepare');scenario('verify-logical')
            docker('stop',names['heart'],names['ob'])
        restore('baseline-ob','rollback-ob');restore('baseline-heart','rollback-heart');verify_sqlite('rollback-ob')
        docker('rm',names['heart'],names['ob']);current_ob=out/'rollback-ob';current_heart=out/'rollback-heart'
        start_ob();start_heart();ready();scenario('verify-baseline')
        evidence['fullDirectoryBackupsVerifiedAndRestored']=True
        evidence['baselineRestoredToNewDirectories']=True
        evidence['completed']=True
        (out/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2))
        print(json.dumps({'completed':True,'evidence':str(out/'evidence.json')}),flush=True)
    finally:
        # Only resources whose random names were allocated by this invocation.
        for key,name in names.items():
            logs=docker('logs',name,check=False)
            # OAuth server logs contain client ids, but never print logs to chat.
            (out/(key+'.private.log')).write_text(logs);os.chmod(out/(key+'.private.log'),0o600)
            docker('rm','-f',name,check=False)
        docker('network','rm',network,check=False)


if __name__=='__main__':
    main()
