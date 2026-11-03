const crypto = require('node:crypto');

// Owner-only, explicitly scoped bridge. Disabled until configured; never uses
// the last active LINE group as a destination.
function createBridge(deps, config = process.env) {
  const token = String(config.TTM_CHATGPT_BRIDGE_TOKEN || '');
  let scopes = [];
  try { scopes = JSON.parse(config.TTM_CHATGPT_BRIDGE_SCOPES || '[]'); } catch {}
  if (!Array.isArray(scopes)) scopes = [];
  scopes = scopes.filter(s => typeof s === 'string' && /^group:C[a-f0-9]{32}$/i.test(s));
  const enabled = token.length >= 32 && scopes.length > 0;
  const authorize = header => {
    const supplied = Buffer.from(String(header || ''));
    const expected = Buffer.from('Bearer ' + token);
    return enabled && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  };
  function scopeOf(args) {
    if (!scopes.includes(args.scope)) throw Error('Group is outside the bridge allowlist');
    return args.scope;
  }
  const idOf = value => {
    if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw Error('Invalid file or request ID');
    return value;
  };
  async function fileOf(args) {
    const scope = scopeOf(args), id = idOf(args.id);
    const rows = await deps.supabaseRequest('line_memories?select=id,file_name,mime_type,scope_id,storage_bucket,storage_path,created_at&id=eq.' + id + '&scope_id=eq.' + encodeURIComponent(scope) + '&limit=1', {method:'GET'});
    const file = rows?.[0];
    if (!file?.storage_bucket || !file.storage_path || file.scope_id !== scope) throw Error('Stored original not found in this group');
    return file;
  }
  const properties = {scope:{type:'string',description:'Exact allowed group scope from list_groups'}};
  const schema = (extra = {}, required = []) => ({type:'object',properties:{...properties,...extra},required:['scope',...required],additionalProperties:false});
  const tools = [
    {name:'list_groups',description:'List only owner-allowed archive groups. Registry presence does not prove current bot membership.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'list_files',description:'List stored originals in one allowed group, newest first. Page with offset; filter filenames with query.',inputSchema:schema({query:{type:'string',maxLength:200},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}})},
    {name:'get_file',description:'Get a 15-minute download link to a stored LINE original. Download and save separately through ChatGPT Library; this tool does not save to Library.',inputSchema:schema({id:{type:'string'}},['id'])},
    {name:'import_file',description:'Store a ChatGPT file in the TTM app archive for the specified group, without sending to LINE. Base64 bytes, up to 12 MiB. Returns an indexed ID after readback verification.',inputSchema:schema({name:{type:'string',maxLength:160},base64:{type:'string'}},['name','base64'])},
    {name:'send_file',description:'Send an archived file to the explicitly selected LINE group. Small JPEG/PNG files appear as images; other files are download links. Requires user instruction to send. Reuse request_id only for an identical retry. Reports API acceptance, not confirmed receipt.',inputSchema:schema({id:{type:'string'},request_id:{type:'string'}},['id','request_id'])}
  ].map(t => ({...t,annotations:{readOnlyHint:!['import_file','send_file'].includes(t.name),destructiveHint:false,openWorldHint:t.name==='send_file'}}));
  async function call(name, args = {}) {
    if (!enabled) throw Error('Bridge is not configured');
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw Error('Arguments must be an object');
    if (name === 'list_groups') {
      const rows = await deps.supabaseRequest('ttm_group_registry?select=scope_id,group_name', {method:'GET'});
      return {groups:(rows || []).filter(g => scopes.includes(g.scope_id))};
    }
    if (name === 'list_files') {
      const scope = scopeOf(args);
      const limit = args.limit ?? 50, offset = args.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0) throw Error('Invalid pagination');
      const query = String(args.query || '');
      if (query.length > 200) throw Error('Query is too long');
      // Escape PostgREST LIKE wildcards; encode the entire filter operand.
      const escaped = query.replace(/[\\%_*]/g, '\\$&');
      const rows = await deps.supabaseRequest('line_memories?select=id,file_name,mime_type,created_at&scope_id=eq.' + encodeURIComponent(scope) + '&storage_path=not.is.null&storage_bucket=not.is.null&order=created_at.desc,id.desc&limit=' + limit + '&offset=' + offset + (query ? '&file_name=ilike.' + encodeURIComponent('%' + escaped + '%') : ''), {method:'GET'});
      return {files:rows || [],next_offset:rows?.length === limit ? offset + limit : null};
    }
    if (name === 'get_file') {
      const f = await fileOf(args);
      return {id:f.id,name:f.file_name,mime:f.mime_type,url:await deps.createSupabaseSignedUrl(f.storage_bucket,f.storage_path,900),expires_in:900,chatgpt_library_saved:false};
    }
    if (name === 'import_file') {
      const scope = scopeOf(args);
      const fileName = String(args.name || '').trim();
      if (!fileName || fileName.length > 160 || /[\\/\x00-\x1f]/.test(fileName) || ['.','..'].includes(fileName)) throw Error('Invalid filename');
      const types = {pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',txt:'text/plain',csv:'text/csv',zip:'application/zip'};
      const mime = types[fileName.split('.').pop().toLowerCase()];
      if (!mime) throw Error('Unsupported file extension');
      const raw = args.base64;
      if (typeof raw !== 'string' || !raw.length || raw.length > 16*1024*1024 || raw.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw Error('Invalid base64 or file exceeds 12 MiB');
      const bytes = Buffer.from(raw,'base64');
      if (!bytes.length || bytes.length > 12*1024*1024 || bytes.toString('base64') !== raw) throw Error('Invalid base64 or file exceeds 12 MiB');
      const saved = await deps.uploadSupabaseFile(bytes,scope,crypto.randomUUID(),fileName,mime);
      const verified = await deps.downloadSupabaseFile(saved.bucket,saved.storagePath);
      const digest = b => crypto.createHash('sha256').update(b).digest('hex');
      if (digest(bytes) !== digest(verified)) throw Error('Stored original verification failed');
      await deps.saveFileMemory({scopeId:scope,userId:null,displayName:'ChatGPT file import',source:{type:'group',groupId:scope.slice(6)},fileName,lineMessageId:null,openaiFileId:null,mime,summary:'Imported from ChatGPT through owner-scoped bridge',storageBucket:saved.bucket,storagePath:saved.storagePath});
      const rows = await deps.supabaseRequest('line_memories?select=id&scope_id=eq.' + encodeURIComponent(scope) + '&storage_path=eq.' + encodeURIComponent(saved.storagePath) + '&limit=1',{method:'GET'});
      if (!rows?.[0]?.id) throw Error('Stored bytes verified, but archive index is unavailable; do not report completion');
      return {id:rows[0].id,name:fileName,size:bytes.length,archive_saved:true,line_sent:false};
    }
    if (name === 'send_file') {
      const requestId = idOf(args.request_id);
      if (!config.LINE_CHANNEL_ACCESS_TOKEN) throw Error('LINE access token is not configured');
      const f = await fileOf(args);
      const url = await deps.createSupabaseSignedUrl(f.storage_bucket,f.storage_path,3600);
      let mode = 'download_link';
      let messages = [{type:'text',text:String(f.file_name || 'File').slice(0,160) + '\n' + url + '\nลิงก์ดาวน์โหลดใช้ได้ 1 ชั่วโมง เรียกขอลิงก์ใหม่ได้จากคลัง'}];
      if (['image/jpeg','image/png'].includes(f.mime_type)) {
        const bytes = await deps.downloadSupabaseFile(f.storage_bucket,f.storage_path);
        if (bytes.length <= 1024*1024) {
          mode = 'image';
          messages = [{type:'image',originalContentUrl:url,previewImageUrl:url}];
        }
      }
      const r = await (deps.fetch || fetch)('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer ' + config.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json','X-Line-Retry-Key':requestId},body:JSON.stringify({to:args.scope.slice(6),messages}),signal:AbortSignal.timeout(20000)});
      if (!r.ok && r.status !== 409) throw Error('LINE rejected the send request (HTTP ' + r.status + ')');
      return {accepted:true,previously_accepted:r.status===409,mode,scope:args.scope,request_id:requestId,delivery_confirmed:false};
    }
    throw Error('Unknown tool');
  }
  return {enabled,authorize,tools,call};
}

function setup(app, deps, config = process.env) {
  const bridge = createBridge(deps,config);
  const auth = (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (!bridge.enabled) return res.status(503).json({error:'ChatGPT bridge is not configured'});
    if (!bridge.authorize(req.get('authorization'))) return res.status(401).json({error:'Unauthorized'});
    next();
  };
  // Stateless Streamable HTTP MCP with JSON responses; no server sessions.
  app.post('/mcp/ttm-files',auth,deps.json({limit:'17mb'}),async(req,res) => {
    const rpc = req.body;
    if (!rpc || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || (rpc.id !== undefined && !(typeof rpc.id === 'string' || typeof rpc.id === 'number'))) return res.status(400).json({error:'Invalid JSON-RPC request'});
    if (rpc.id === undefined) return res.sendStatus(202);
    const result = value => res.json({jsonrpc:'2.0',id:rpc.id,result:value});
    if (rpc.method === 'initialize') return result({protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'art-ttm-files',version:'0.1.0'}});
    if (rpc.method === 'ping') return result({});
    if (rpc.method === 'tools/list') return result({tools:bridge.tools});
    if (rpc.method !== 'tools/call') return res.json({jsonrpc:'2.0',id:rpc.id,error:{code:-32601,message:'Method not found'}});
    try {
      const value = await bridge.call(rpc.params?.name,rpc.params?.arguments);
      return result({content:[{type:'text',text:JSON.stringify(value)}]});
    } catch(e) {
      // Do not return provider bodies, credentials, or storage paths.
      const safe = /^(Group |Invalid |Stored |Unsupported |Query |Unknown |Bridge |LINE )/.test(e.message) ? e.message : 'File operation failed; completion is not confirmed';
      return result({isError:true,content:[{type:'text',text:safe}]});
    }
  });
  app.get('/mcp/ttm-files',auth,(req,res) => res.sendStatus(405));
  app.delete('/mcp/ttm-files',auth,(req,res) => res.sendStatus(405));
  return bridge;
}
module.exports = {createBridge,setup};
