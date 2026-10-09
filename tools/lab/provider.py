"""Isolated deterministic model fixture and TLS proxy; never a fake OB.

Run only on the laboratory's internal Docker network. Do not expose publicly.
No request bodies, cookies, tokens or memory content are logged.
"""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import http.client
import json
import math
import os
import re
import ssl
import threading
from pathlib import Path
import frontmatter

control = {'fail_model': False, 'drop_write_response': False, 'mcpWrites': 0, 'tokenRefreshes': 0}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def respond(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_GET(self): self.handle_request()
    def do_POST(self): self.handle_request()

    def handle_request(self):
        raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/lab/control':
            if raw: control.update(json.loads(raw))
            return self.respond(control)
        if self.path.startswith('/lab/bucket/'):
            ident = self.path.removeprefix('/lab/bucket/')
            if not re.fullmatch('[a-f0-9]{12}', ident): return self.respond({'error':'invalid id'},400)
            for path in Path('/ob-vault').rglob('*.md'):
                if '_app' in path.parts: continue
                post = frontmatter.load(path)
                if post.metadata.get('id') == ident:
                    return self.respond({'id':ident,'metadata':post.metadata,'content':post.content})
            return self.respond({'error':'not found'},404)
        if self.server.server_port == 8001:
            if control['fail_model']: return self.respond({'error': {'message': 'laboratory provider outage'}}, 503)
            body = json.loads(raw)
            if self.path.endswith('/embeddings'):
                texts = body['input'] if isinstance(body['input'], list) else [body['input']]
                vectors = []
                for i, text in enumerate(texts):
                    values = [0.0] * 32
                    for token in re.findall(r'\w+', str(text)) + [str(text)[j:j+2] for j in range(len(str(text))-1)]:
                        h = hashlib.sha256(token.encode()).digest(); values[h[0] % 32] += 1 if h[1] % 2 else -1
                    norm = math.sqrt(sum(x*x for x in values)) or 1
                    vectors.append({'object': 'embedding', 'index': i, 'embedding': [x/norm for x in values]})
                return self.respond({'object': 'list', 'model': body.get('model', 'lab-embedding'), 'data': vectors,
                                     'usage': {'prompt_tokens': 1, 'total_tokens': 1}})
            messages = body.get('messages', []); system = str(messages[0].get('content', '')) if messages else ''
            user = str(messages[-1].get('content', '')) if messages else ''
            if 'same_event' in system or 'same_event' in user:
                value = {'same_event': 'LAB_SAME_EVENT' in user, 'confidence': .99, 'reason': 'deterministic lab fixture'}
            elif '日记整理' in system:
                value = [{'content': user, 'domain': ['测试'], 'tags': ['lab'], 'importance': 5, 'valence': .5, 'arousal': .3}]
            else:
                value = {'domain': ['测试'], 'tags': ['lab'], 'suggested_name': '实验记忆', 'importance': 5,
                         'valence': .5, 'arousal': .3, 'why_remembered': '我选择保留这条实验记忆', 'resolved': False}
            return self.respond({'id': 'lab-completion', 'object': 'chat.completion', 'model': body.get('model', 'lab-model'),
                                 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': json.dumps(value, ensure_ascii=False)},
                                              'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}})
        # TLS front for the real OB container. Include real OAuth and storage routes.
        if self.path == '/oauth/token' and b'refresh_token' in raw: control['tokenRefreshes'] += 1
        write = False
        if self.path in ['/mcp', '/mcp-extra']:
            try:
                message = json.loads(raw)
                write = message.get('method') == 'tools/call' and message.get('params', {}).get('name') in ['hold', 'grow', 'trace', 'I', 'plan', 'letter_write', 'letter_lock_update']
                if write: control['mcpWrites'] += 1
            except ValueError: pass
        connection = http.client.HTTPConnection('ob', 8000, timeout=150)
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ['host', 'connection']}
        headers['Host'] = 'ob.lab.test'; headers['X-Forwarded-Proto'] = 'https'; headers['X-Forwarded-Host'] = 'ob.lab.test'
        try:
            connection.request(self.command, self.path, body=raw, headers=headers)
            result = connection.getresponse(); payload = result.read()
            if write and control['drop_write_response']:
                control['drop_write_response'] = False
                self.close_connection = True; return
            self.send_response(result.status)
            for k, v in result.getheaders():
                if k.lower() not in ['connection', 'transfer-encoding', 'content-length']: self.send_header(k, v)
            self.send_header('Content-Length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
        finally: connection.close()


plain = ThreadingHTTPServer(('0.0.0.0', 8001), Handler)
threading.Thread(target=plain.serve_forever, daemon=True).start()
tls = ThreadingHTTPServer(('0.0.0.0', 443), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain('/cert/server.crt', '/cert/server.key')
tls.socket = context.wrap_socket(tls.socket, server_side=True)
tls.serve_forever()
