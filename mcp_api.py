"""Stateless Streamable HTTP MCP, using the same engine operations as the view."""
import base64, binascii, json
import library, wisdom


def schema(props, required=()):
    return {'type': 'object', 'properties': props, 'required': list(required), 'additionalProperties': False}


S = {'type': 'string'}
TOOLS = [
    {'name': 'wisdom_authoring_contract', 'description': 'Read the release-bound author/pipeline pin, full workflow documentation, prompt and allowlisted toolkit digests. Default orchestrator may not substitute prose.', 'inputSchema': schema({})},
    {'name': 'wisdom_authoring_toolkit', 'description': 'Download installed app-trusted author toolkit ZIP base64 bound to exact contract and toolkit digests. Never sourced from document imports.', 'inputSchema': schema({'contract_sha256': S, 'toolkit_sha256': S}, ['contract_sha256', 'toolkit_sha256'])},
    {'name': 'wisdom_request_route', 'description': 'Read actual Service route evidence for a request. Accepted is not confirmed effective execution.', 'inputSchema': schema({'seq': {'type': 'integer'}}, ['seq'])},
    {'name': 'wisdom_revision_preview', 'description': 'Validate/stage one existing collection revision against exact old and new ZIP SHA256. No reader or personal-state change.', 'inputSchema': schema({'id': S, 'collection_id': S, 'old_sha256': S, 'new_sha256': S, 'zip_base64': S}, ['id', 'collection_id', 'old_sha256', 'new_sha256', 'zip_base64'])},
    {'name': 'wisdom_revision_apply', 'description': 'Apply an explicitly confirmed exact preview. Retain prior editions, IDs and personal state; changed anchors become earlier-edition quotes.', 'inputSchema': schema({'id': S, 'collection_id': S, 'old_sha256': S, 'new_sha256': S, 'token': S, 'confirm': {'type': 'boolean', 'const': True}}, ['id', 'collection_id', 'old_sha256', 'new_sha256', 'token', 'confirm'])},
    {'name': 'wisdom_request', 'description': 'Durably save a typed request, and send only if the operator enabled optional Agent Service. QA true never launches work.', 'inputSchema': schema({'text': S, 'seq': {'type': 'integer'}, 'qa': {'type': 'boolean'}})},
    {'name': 'wisdom_export_preview', 'description': 'Preview exactly one enabled collection download: chapters, files, digests and rights. No personal state; never publishes.', 'inputSchema': schema({'id': S}, ['id'])},
    {'name': 'wisdom_export', 'description': 'Download the previewed collection as ZIP base64 only after explicit user confirmation. Requires preview sha256 and confirm:true. Never publishes or changes library scope.', 'inputSchema': schema({'id': S, 'sha256': S, 'confirm': {'type': 'boolean', 'const': True}}, ['id', 'sha256', 'confirm'])},
    {'name': 'wisdom_library', 'description': 'List imported bundles and the explicitly configured collection source.', 'inputSchema': schema({})},
    {'name': 'wisdom_state', 'description': 'Read enabled collections, chapters, progress and highlights.', 'inputSchema': schema({})},
    {'name': 'wisdom_import', 'description': 'Preview/stage a version-1 ZIP document bundle. It stays disabled until explicitly enabled.', 'inputSchema': schema({'zip_base64': S}, ['zip_base64'])},
    {'name': 'wisdom_source_import', 'description': 'Stage one id from the configured manifest source only.', 'inputSchema': schema({'id': S}, ['id'])},
    {'name': 'wisdom_bundle', 'description': 'Enable/install, disable, or remove from library. All actions retain bundle files and personal state.', 'inputSchema': schema({'id': S, 'action': {'type': 'string', 'enum': ['enable', 'disable', 'remove']}}, ['id', 'action'])},
    {'name': 'wisdom_reaction', 'description': 'Save a chapter/thinker reaction using the documented HTTP reaction payload.', 'inputSchema': schema({'kind': S, 'id': S, 'field': S, 'value': {'type': ['boolean', 'integer']}}, ['kind', 'id', 'field', 'value'])},
    {'name': 'wisdom_highlight', 'description': 'Add a highlight bound to displayed body_sha256 (entry_id,start,end,text,body_sha256, optional note); stale or missing identity fails. Remove one by id, or set/clear its note with {action:"note",id,note}.', 'inputSchema': schema({'action': {'type': 'string', 'enum': ['add', 'remove', 'note']}, 'entry_id': S, 'start': {'type': 'integer'}, 'end': {'type': 'integer'}, 'text': S, 'body_sha256': S, 'id': {'type': 'integer'}, 'note': {'type': 'string', 'maxLength': 8000}}, ['action'])},
]


def dispatch(d):
    import server
    key = d.get('id')
    if d.get('jsonrpc') != '2.0' or not isinstance(d.get('method'), str):
        return 200, {'jsonrpc': '2.0', 'id': key, 'error': {'code': -32600, 'message': 'Invalid request'}}
    method = d['method']
    if key is None and method.startswith('notifications/'):
        return 202, {}
    out = {'jsonrpc': '2.0', 'id': key}
    if method == 'initialize':
        out['result'] = {'protocolVersion': '2025-03-26', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'wisdom', 'version': '0.4.0-private.24'}}
    elif method == 'ping':
        out['result'] = {}
    elif method == 'tools/list':
        out['result'] = {'tools': TOOLS}
    elif method == 'tools/call':
        p = d.get('params', {})
        if not isinstance(p, dict):
            out['error'] = {'code': -32602, 'message': 'Invalid params'}
            return 200, out
        a = p.get('arguments', {}); name = p.get('name')
        try:
            tool = next((t for t in TOOLS if t['name'] == name), None)
            if not tool or not isinstance(a, dict) or set(a) - set(tool['inputSchema']['properties']) or set(tool['inputSchema']['required']) - set(a):
                raise ValueError('Unknown tool or invalid arguments')
            with library.LOCK, server.db() as c:
                if name == 'wisdom_authoring_contract':
                    import authoring_toolkit
                    result = authoring_toolkit.describe()
                elif name == 'wisdom_authoring_toolkit':
                    import authoring_toolkit
                    result = authoring_toolkit.download(a)
                elif name == 'wisdom_request_route':
                    result = server.request_route(a)
                elif name in ('wisdom_revision_preview', 'wisdom_revision_apply'):
                    import collection_revision
                    result = collection_revision.preview(c, a) if name.endswith('_preview') else collection_revision.apply(c, a)
                elif name == 'wisdom_request':
                    status, result = server.submit_request(a)
                    result = dict(result, http_status=status)
                elif name == 'wisdom_library':
                    result = {'bundles': library.list_bundles(c), 'source': library.source()}
                elif name in ('wisdom_export_preview', 'wisdom_export'):
                    import collection_export
                    if name == 'wisdom_export_preview':
                        result = collection_export.preview(c, a)
                    else:
                        details, raw = collection_export.download(c, a)
                        result = {'id': details['id'], 'sha256': details['sha256'],
                                  'zip_base64': base64.b64encode(raw).decode('ascii')}
                elif name == 'wisdom_state':
                    result = wisdom.state(c)
                elif name == 'wisdom_import':
                    raw = base64.b64decode(a['zip_base64'], validate=True)
                    result = library.stage(c, raw)
                elif name == 'wisdom_source_import':
                    result = library.import_source(c, a['id'])
                elif name == 'wisdom_bundle':
                    result = library.action(c, a); wisdom.init(c)
                elif name == 'wisdom_reaction':
                    result = wisdom.react(c, a)
                else:
                    result = wisdom.highlight(c, a)
            out['result'] = {'content': [{'type': 'text', 'text': json.dumps(result)}], 'isError': False}
        except (ValueError, TypeError, OSError, AttributeError, binascii.Error, server.AdmissionError) as e:
            out['result'] = {'content': [{'type': 'text', 'text': str(e)}], 'isError': True}
    else:
        out['error'] = {'code': -32601, 'message': 'Method not found'}
    return 200, out
