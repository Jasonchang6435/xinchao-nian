import json,subprocess
cases=[
 ('config_directory_preserved','xinchao-zeabur-ombre:20261009',{},'mkdir -p /tmp/not-config; echo keep > /tmp/not-config/marker; OMBRE_CONFIG_PATH=/tmp/not-config /usr/local/bin/ob-entrypoint; rc=$?; test "$rc" -ne 0 && test "$(cat /tmp/not-config/marker)" = keep'),
 ('missing_ob_credentials_rejected','xinchao-zeabur-ombre:20261009',{},'/usr/local/bin/ob-entrypoint; test "$?" -ne 0'),
 ('ob_auth_cannot_be_disabled','xinchao-zeabur-ombre:20261009',{'OMBRE_MCP_REQUIRE_AUTH':'false'},'/usr/local/bin/ob-entrypoint; test "$?" -ne 0'),
 ('ob_placeholder_rejected','xinchao-zeabur-ombre:20261009',{'OMBRE_MCP_SERVICE_TOKEN':'REPLACE_WITH_INDEPENDENT_RANDOM_64_HEX','OMBRE_DASHBOARD_PASSWORD':'a'*64},'/usr/local/bin/ob-entrypoint; test "$?" -ne 0'),
 ('heart_placeholder_rejected','xinchao-zeabur-heart:20261009',{'SERVICE_TOKEN':'REPLACE_WITH_INDEPENDENT_RANDOM_64_HEX'},'/usr/local/bin/xinchao-entrypoint true; test "$?" -ne 0'),
]
for name,image,env,script in cases:
 cmd=['docker','run','--rm','--network','none','--entrypoint','sh']
 for k,v in env.items():cmd.extend(['-e',k+'='+v])
 r=subprocess.run(cmd+[image,'-c',script],capture_output=True,text=True)
 assert r.returncode==0,(name,r.stderr)
print(json.dumps({'passed':[c[0] for c in cases],'productionContacted':False}))
