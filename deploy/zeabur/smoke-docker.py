"""Run the two built images on a private network with fresh synthetic volumes.

Usage: python3 deploy/zeabur/smoke-docker.py --output /absolute/new-directory
No host ports are published. Only resources created by this run are removed.
"""
import argparse,json,os,secrets,subprocess,time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',required=True)
p.add_argument('--heart-image',default='xinchao-zeabur-heart:20261009')
p.add_argument('--ob-image',default='xinchao-zeabur-ombre:20261009');a=p.parse_args()
lab=Path(a.output)
if not lab.is_absolute() or lab.exists():raise SystemExit('output must be a new absolute directory')
lab.mkdir(mode=0o700);repo=Path(__file__).resolve().parents[2]
name='xinchao-zlab-'+secrets.token_hex(4);net=name+'-net';heart=name+'-heart';ob=name+'-ob';vols=[name+'-state',name+'-memory']
settings={k:secrets.token_hex(32) for k in ('memory','service','dashboard','approval','ob_password')}
(lab/'private.json').write_text(json.dumps(settings));os.chmod(lab/'private.json',0o600)
def docker(*args,check=True):
 r=subprocess.run(['docker',*args],capture_output=True,text=True)
 if check and r.returncode:raise RuntimeError('docker '+args[0]+' failed: '+r.stderr[-1800:])
 return r
ob_env={'OMBRE_MCP_SERVICE_TOKEN':settings['memory'],'OMBRE_DASHBOARD_PASSWORD':settings['ob_password'],'OMBRE_MCP_REQUIRE_AUTH':'true','OMBRE_COMPRESS_API_KEY':'','OMBRE_EMBED_API_KEY':'','DYNAMIC_MIND_URL':'http://xinchao:18110','DYNAMIC_MIND_TOKEN':settings['service']}
heart_env={'SERVICE_TOKEN':settings['service'],'OMBRE_MCP_URL':'http://ombre:8000/mcp','OMBRE_MCP_TOKEN':settings['memory'],'OMBRE_READ_ENABLED':'true','CONTEXT_OMBRE_ENABLED':'true','OMBRE_WRITE_ENABLED':'false','SHADOW_MODE':'true','MCP_ENABLED':'false','OAUTH_ENABLED':'false','OAUTH_PUBLIC_BASE_URL':'https://xinchao.example.test','OAUTH_APPROVAL_TOKEN':settings['approval'],'DASHBOARD_ENABLED':'true','DASHBOARD_PUBLIC_BASE_URL':'http://localhost:18110','DASHBOARD_ACCESS_TOKEN':settings['dashboard'],'DREAM_ENABLED':'false','MODEL_API_KEY':''}
def env_file(path,values):
 path.write_text(''.join(k+'='+v+'\n' for k,v in values.items()));os.chmod(path,0o600)
def start():
 env_file(lab/'ob.env',ob_env);env_file(lab/'heart.env',heart_env)
 docker('run','-d','--name',ob,'--network',net,'--network-alias','ombre','--env-file',str(lab/'ob.env'),'-v',vols[1]+':/app/buckets','-v',str(lab)+':/lab','-v',str(repo/'deploy/zeabur/smoke-probe.py')+':/probe.py:ro',a.ob_image)
 docker('run','-d','--name',heart,'--network',net,'--network-alias','xinchao','--env-file',str(lab/'heart.env'),'-v',vols[0]+':/app/state',a.heart_image)
def stop():
 for container in (heart,ob):docker('rm','-f',container,check=False)
def probe(phase):
 r=docker('exec',ob,'python','/probe.py',phase);print(r.stdout.strip(),flush=True)
 uid=docker('exec',heart,'sh','-c',"sed -n '/^Uid:/p' /proc/1/status").stdout.split()[1:]
 assert uid==['1000']*4,uid
try:
 docker('network','create','--internal',net)
 for v in vols:docker('volume','create',v)
 start();probe('initial');stop()
 heart_env.update(MCP_ENABLED='true',OAUTH_ENABLED='true')
 start();probe('write');stop()
 start();probe('recreated-1');stop()
 start();probe('recreated-2')
 for container in (heart,ob):
  docker('cp',container+':'+('/app/state' if container==heart else '/app/buckets'),str(lab/('heart-snapshot' if container==heart else 'ob-snapshot')))
 results=[json.loads((lab/(phase+'-evidence.json')).read_text()) for phase in ('initial','write','recreated-1','recreated-2')]
 result={'phases':results,'checks':sum(x['passed'] for x in results),'heartUid':1000,'containerRecreations':3,'productionContacted':False,'onlineZeaburVerified':False,'onlineClaudeVerified':False,'fullRestoreTested':False}
 (lab/'evidence.json').write_text(json.dumps(result,indent=2)+'\n')
 print('PASS',result['checks'],'checks; 3 container recreations; uid 1000; private network',flush=True)
except Exception:
 for container in (heart,ob):
  (lab/(container+'-failure.log')).write_text(docker('logs',container,check=False).stdout+docker('logs',container,check=False).stderr)
 raise
finally:
 stop()
 for v in vols:docker('volume','rm',v,check=False)
 docker('network','rm',net,check=False)
