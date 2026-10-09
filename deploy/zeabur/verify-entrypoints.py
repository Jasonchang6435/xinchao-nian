import json,os,subprocess
heart_image=os.environ.get('XINCHAO_TEST_IMAGE','xinchao-zeabur-heart:20261009')
cases=[
 ('config_directory_preserved','xinchao-zeabur-ombre:20261009',{},'mkdir -p /tmp/not-config; echo keep > /tmp/not-config/marker; OMBRE_CONFIG_PATH=/tmp/not-config /usr/local/bin/ob-entrypoint; rc=$?; test "$rc" -ne 0 && test "$(cat /tmp/not-config/marker)" = keep'),
 ('missing_ob_credentials_rejected','xinchao-zeabur-ombre:20261009',{},'/usr/local/bin/ob-entrypoint; test "$?" -ne 0'),
 ('ob_auth_cannot_be_disabled','xinchao-zeabur-ombre:20261009',{'OMBRE_MCP_REQUIRE_AUTH':'false'},'/usr/local/bin/ob-entrypoint; test "$?" -ne 0'),
 ('ob_placeholder_rejected','xinchao-zeabur-ombre:20261009',{'OMBRE_MCP_SERVICE_TOKEN':'REPLACE_WITH_INDEPENDENT_RANDOM_64_HEX','OMBRE_DASHBOARD_PASSWORD':'a'*64},'/usr/local/bin/ob-entrypoint; test "$?" -ne 0'),
 ('heart_placeholder_rejected','xinchao-zeabur-heart:20261009',{'SERVICE_TOKEN':'REPLACE_WITH_INDEPENDENT_RANDOM_64_HEX'},'/usr/local/bin/xinchao-entrypoint true; test "$?" -ne 0'),
 ('heart_root_restore_readable',heart_image,{},'printf private-state > /app/state/state.json; printf private-auth > /app/state/oauth.json; chmod 600 /app/state/state.json /app/state/oauth.json; /usr/local/bin/xinchao-entrypoint node -e "const fs=require(\'node:fs\');if(process.getuid()!==1000||fs.readFileSync(\'/app/state/state.json\',\'utf8\')!==\'private-state\'||fs.readFileSync(\'/app/state/oauth.json\',\'utf8\')!==\'private-auth\'||(fs.statSync(\'/app/state/oauth.json\').mode&511)!==384)process.exit(1)"'),
 ('heart_unrelated_file_untouched',heart_image,{},'printf unrelated > /app/state/unrelated.json; chmod 640 /app/state/unrelated.json; /usr/local/bin/xinchao-entrypoint true && test "$(stat -c %u:%a /app/state/unrelated.json)" = 0:640'),
 ('heart_state_symlink_rejected',heart_image,{},'printf keep > /tmp/original; ln -s /tmp/original /app/state/oauth.json; /usr/local/bin/xinchao-entrypoint true; rc=$?; test "$rc" -ne 0 && test "$(cat /tmp/original)" = keep'),
 ('heart_state_hardlink_rejected',heart_image,{},'printf keep > /app/state/original; ln /app/state/original /app/state/oauth.json; /usr/local/bin/xinchao-entrypoint true; rc=$?; test "$rc" -ne 0 && test "$(stat -c %u /app/state/original)" = 0'),
]
for name,image,env,script in cases:
 cmd=['docker','run','--rm','--network','none','--entrypoint','sh']
 for k,v in env.items():cmd.extend(['-e',k+'='+v])
 r=subprocess.run(cmd+[image,'-c',script],capture_output=True,text=True)
 assert r.returncode==0,(name,r.stderr)
print(json.dumps({'passed':[c[0] for c in cases],'productionContacted':False}))
