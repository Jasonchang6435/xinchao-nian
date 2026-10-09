"""Validate against downloaded official schemas, plus deployment invariants.

python verify-template.py --schema-dir /path/containing/template.json/prebuilt.json
Requires PyYAML/jsonschema (already present in the bundled OB image).
This is an offline check; it does not create a Zeabur project.
"""
import argparse,json
from pathlib import Path
import yaml
from jsonschema import Draft7Validator
from referencing import Registry,Resource
p=argparse.ArgumentParser();p.add_argument('--schema-dir',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parents[2]
schema=json.loads((a.schema_dir/'template.json').read_text())
service_schema=json.loads((a.schema_dir/'prebuilt.json').read_text())
registry=Registry().with_resource('https://schema.zeabur.app/prebuilt.json',Resource.from_contents(service_schema))
spec=yaml.safe_load((root/'zeabur-template.yaml').read_text())
Draft7Validator(schema,registry=registry).validate(spec)
services={s['name']:s for s in spec['spec']['services']}
assert set(services)=={'ombre','xinchao'}
assert (root/'Dockerfile').exists()
for name,port,volume,dockerfile in [('ombre',8000,'/app/buckets','Dockerfile.ombre'),('xinchao',18110,'/app/state','Dockerfile')]:
 s=services[name];env=s['spec']['env'];source=s['spec']['source']
 assert s['template']=='GIT' and source['source']=='GITHUB'
 assert source['repo']==1410500658 and source['branch']=='codex/zeabur-full-stack'
 assert env['ZBPACK_DOCKERFILE_PATH']['default']==dockerfile
 assert s['spec']['ports']==[{'id':'web','port':port,'type':'HTTP'}]
 assert s['spec']['volumes'][0]['dir']==volume
 assert s['spec']['healthCheck']['http']['path']=='/health'
 assert (root/dockerfile).exists()
 assert json.loads((root/('zbpack.'+name+'.json')).read_text())=={'dockerfile':{'path':dockerfile}}
assert services['xinchao']['dependencies']==['ombre']
env=services['xinchao']['spec']['env']
assert env['OAUTH_PUBLIC_BASE_URL']['default']=='https://${ZEABUR_WEB_DOMAIN}'
assert env['DASHBOARD_PUBLIC_BASE_URL']['default']=='https://${ZEABUR_WEB_DOMAIN}'
assert 'https://${PUBLIC_DOMAIN}' not in (root/'zeabur-template.yaml').read_text()
assert 'https://${OB_DOMAIN}' not in (root/'zeabur-template.yaml').read_text()
assert env['MCP_ENABLED']['default']=='false' and env['OAUTH_ENABLED']['default']=='false'
assert env['OMBRE_WRITE_ENABLED']['default']=='false' and env['SHADOW_MODE']['default']=='true'
assert env['OMBRE_MCP_TOKEN']['default']=='${OMBRE_MCP_SERVICE_TOKEN}'
assert services['ombre']['spec']['env']['OMBRE_MCP_REQUIRE_AUTH']['default']=='true'
assert 'gaoli.zeabur.app' not in (root/'zeabur-template.yaml').read_text()
print('PASS: official schemas; two Git/Docker services; separate volumes; credentials; initial closed MCP')
