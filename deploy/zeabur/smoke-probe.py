"""Container probe for smoke-docker.py; synthetic data only, no production URLs."""
import base64, hashlib, io, json, os, sys, time, urllib.parse, zipfile
from pathlib import Path
import frontmatter
import httpx

lab=Path('/lab'); phase=sys.argv[1]
settings=json.loads((lab/'private.json').read_text())
checks=[]
client=httpx.Client(timeout=60,trust_env=False,follow_redirects=False)
heart='http://xinchao:18110'; ob='http://ombre:8000'
def check(name,condition):
    if not condition: raise AssertionError(name)
    checks.append(name)
def request(base,path,**kw):return client.request(kw.pop('method','GET'),base+path,**kw)
def wait(base):
    for _ in range(80):
        try:
            if request(base,'/health').status_code==200:return
        except httpx.HTTPError:pass
        time.sleep(1)
    raise RuntimeError('container did not become healthy')
wait(ob);wait(heart)
check('both_http_health',True)
check('ob_dashboard_html',request(ob,'/').status_code==200)
check('ob_dashboard_private_api_requires_login',request(ob,'/api/buckets').status_code==401)
check('heart_dashboard_requires_session',request(heart,'/dashboard/api/memory-map').status_code==401)
if phase=='initial':
    check('heart_mcp_disabled_by_default',request(heart,'/mcp',method='POST',json={}).status_code==401 or request(heart,'/mcp',method='POST',json={}).status_code==404)
    check('initial_blank_user_memories',not [p for p in Path('/app/buckets').rglob('*.md') if '_app' not in p.parts])
else:
    # Exercise actual HTTP OAuth DCR -> PKCE authorization -> token -> MCP.
    session_file=lab/'session.json'
    if phase=='write':
        reg=request(heart,'/oauth/register',method='POST',json={'client_name':'isolated-docker-smoke','redirect_uris':['http://127.0.0.1:18111/callback']})
        check('heart_oauth_dynamic_registration',reg.status_code==201)
        client_id=reg.json()['client_id'];verifier='a'*64
        challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
        params={'client_id':client_id,'redirect_uri':'http://127.0.0.1:18111/callback','response_type':'code','code_challenge':challenge,'code_challenge_method':'S256','state':'synthetic-smoke','resource':'https://xinchao.example.test/mcp'}
        a=request(heart,'/oauth/authorize',method='POST',data={**params,'approval_token':settings['approval']})
        check('heart_oauth_approval_redirect',a.status_code==302)
        q=urllib.parse.parse_qs(urllib.parse.urlparse(a.headers['location']).query)
        check('heart_oauth_state_returned',q.get('state')==['synthetic-smoke'])
        token=request(heart,'/oauth/token',method='POST',data={'grant_type':'authorization_code','code':q['code'][0],'client_id':client_id,'redirect_uri':params['redirect_uri'],'code_verifier':verifier,'resource':params['resource']})
        check('heart_oauth_pkce_token',token.status_code==200)
        session={'access':token.json()['access_token'],'refresh':token.json()['refresh_token'],'client':client_id}
    else:session=json.loads(session_file.read_text())
    headers={'Authorization':'Bearer '+session['access'],'Content-Type':'application/json','Accept':'application/json, text/event-stream'}
    counter=0
    def mcp(method,params=None):
        global counter
        counter+=1
        r=request(heart,'/mcp',method='POST',headers=headers,json={'jsonrpc':'2.0','id':counter,'method':method,'params':params or {}})
        check(method+'_http_'+str(counter),r.status_code==200)
        if r.headers.get('mcp-session-id'):headers['Mcp-Session-Id']=r.headers['mcp-session-id']
        value=r.json();assert 'error' not in value,value
        return value['result']
    mcp('initialize',{'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'smoke','version':'1'}})
    tools=mcp('tools/list')['tools'];names={x['name'] for x in tools}
    check('heart_and_ob_tools_available',{'xinchao_context','hold','breath','trace'}.issubset(names))
    check('known_original_advanced_recall_gap', 'breath_advanced' not in names)
    marker='Docker synthetic migration-free memory: persistent body 20261009.'
    if phase=='write':
        value=mcp('tools/call',{'name':'hold','arguments':{'content':marker,'tags':'docker-lab','importance':6}})
        check('gateway_hold_succeeds',not value.get('isError',False))
        buckets=[]
        for p in Path('/app/buckets').rglob('*.md'):
            if '_app' in p.parts:continue
            post=frontmatter.load(p)
            if post.content==marker:buckets.append(dict(post.metadata))
        check('exact_body_persisted_once',len(buckets)==1)
        session['bucket_id']=buckets[0]['id']
        event=mcp('tools/call',{'name':'xinchao_event','arguments':{'session_id':'synthetic-stable-session','event_id':'docker-sharing-event-20261009','interaction_type':'sharing'}})
        check('heart_state_event_written',not event.get('isError',False))
        session_file.write_text(json.dumps(session));os.chmod(session_file,0o600)
    else:
        buckets=[]
        for p in Path('/app/buckets').rglob('*.md'):
            if '_app' in p.parts:continue
            post=frontmatter.load(p)
            if post.content==marker:buckets.append(dict(post.metadata))
        check('body_and_id_survive_recreated_container',len(buckets)==1 and buckets[0]['id']==session['bucket_id'])
    state=request(heart,'/v1/state',headers={'Authorization':'Bearer '+settings['service']})
    check('heart_event_survives_recreation',state.status_code==200 and 'docker-sharing-event-20261009' in state.text)
    recall=mcp('tools/call',{'name':'breath','arguments':{'query':'persistent body 20261009'}})
    text='\n'.join(x.get('text','') for x in recall.get('content',[]))
    check('gateway_recall_returns_memory',not recall.get('isError',False) and marker in text)
    dash=request(heart,'/dashboard/session',method='POST',json={'accessToken':settings['dashboard'],'mode':'header'})
    check('heart_dashboard_independent_credentials',dash.status_code==200)
    dh={'Authorization':'Bearer '+dash.json()['token']}
    for _ in range(20):
        stars=request(heart,'/dashboard/api/memory-map',headers=dh)
        if session['bucket_id'] in stars.text:break
        time.sleep(0.25)
    check('heart_star_map_contains_persisted_id',stars.status_code==200 and session['bucket_id'] in stars.text)
    check('heart_dashboard_token_is_not_mcp_token',request(heart,'/mcp',method='POST',headers=dh,json={'jsonrpc':'2.0','id':1,'method':'tools/list'}).status_code==401)
    check('ob_sidecar_map_auth',request(ob,'/api/bucket-map',headers={'Authorization':'Bearer '+settings['memory']}).status_code==200)
    login=request(ob,'/auth/login',method='POST',json={'password':settings['ob_password']})
    check('ob_dashboard_login',login.status_code==200)
    exported=request(ob,'/api/export')
    check('ob_logical_export',exported.status_code==200)
    with zipfile.ZipFile(io.BytesIO(exported.content)) as z:
        check('export_contains_synthetic_body',any(marker.encode() in z.read(n) for n in z.namelist() if n.endswith('.md')))
        check('export_has_integrity_manifest','backup_manifest.json' in z.namelist())
    (lab/('export-'+phase+'.zip')).write_bytes(exported.content)
    if phase!='write':
        refreshed=request(heart,'/oauth/token',method='POST',data={'grant_type':'refresh_token','refresh_token':session['refresh'],'client_id':session['client'],'resource':'https://xinchao.example.test/mcp'})
        check('oauth_grant_survives_recreation',refreshed.status_code==200)
        session['refresh']=refreshed.json()['refresh_token'];session['access']=refreshed.json()['access_token']
        session_file.write_text(json.dumps(session));os.chmod(session_file,0o600)
result={'phase':phase,'checks':checks,'passed':len(checks),'productionContacted':False,'knownLimitations':['Original heart calls breath_advanced but bundled OB does not expose it.'],'onlineZeaburVerified':False,'onlineClaudeVerified':False}
(lab/(phase+'-evidence.json')).write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'phase':phase,'passed':len(checks),'productionContacted':False}))
