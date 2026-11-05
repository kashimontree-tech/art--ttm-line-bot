const crypto = require('node:crypto');
const {createBridge} = require('./chatgpt-file-bridge');
// Trusted service-role queue only. No public enqueue route or LINE token export.
function createOutbox(deps, config = process.env) {
  let busy = false;
  const fetchImpl = deps.fetch || fetch;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const queue = await deps.supabaseRequest('ttm_outbound_requests?status=eq.pending&order=created_at.asc&limit=5', {method:'GET'});
      for (const candidate of queue || []) {
        const path = 'ttm_outbound_requests?id=eq.' + candidate.id;
        const claimed = await deps.supabaseRequest(path + '&status=eq.pending', {method:'PATCH',prefer:'return=representation',body:JSON.stringify({status:'sending',updated_at:new Date().toISOString()})});
        if (!claimed?.length) continue;
        const job = claimed[0];
        let accepted = false;
        try {
          if (!/^[a-f0-9-]{36}$/i.test(job.id) || !/^group:C[a-f0-9]{32}$/i.test(job.scope_id)) throw Error('Invalid destination');
          if (job.authorized_by !== 'owner_explicit_chatgpt' || !job.authorization_note?.trim()) throw Error('Missing explicit owner authorization');
          const expires = Date.parse(job.expires_at);
          if (!Number.isFinite(expires) || Date.now() > expires) throw Error('Request expired; ask owner before sending later');
          const groups = await deps.supabaseRequest('ttm_group_registry?select=scope_id,group_name&scope_id=eq.' + encodeURIComponent(job.scope_id) + '&limit=1', {method:'GET'});
          if (!groups?.some(g => g.scope_id === job.scope_id)) throw Error('Destination is not registered');
          const token = String(config.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
          if (!token) throw Error('LINE token missing');
          const summary = await fetchImpl('https://api.line.me/v2/bot/group/' + job.scope_id.slice(6) + '/summary', {headers:{Authorization:'Bearer ' + token},signal:AbortSignal.timeout(15000)});
          if (!summary.ok) throw Error('LINE group preflight HTTP ' + summary.status);
          if ((await summary.json()).groupId !== job.scope_id.slice(6)) throw Error('LINE group identity mismatch');
          // The queue is already authenticated server-side. Reuse bridge byte,
          // group and media validation with a single exact destination.
          const bridge = createBridge({...deps,fetch:fetchImpl}, {...config,LINE_CHANNEL_ACCESS_TOKEN:token,TTM_CHATGPT_BRIDGE_TOKEN:crypto.randomBytes(32).toString('hex'),TTM_CHATGPT_BRIDGE_SCOPES:JSON.stringify([job.scope_id]),TTM_CHATGPT_BRIDGE_ALL_REGISTERED_GROUPS:'0'});
          const args = {scope:job.scope_id,request_id:job.id};
          let result;
          if (job.kind === 'text') {
            result = await bridge.call('send_text',{...args,text:job.payload?.text,mentions:job.payload?.mentions});
          } else if (job.kind === 'file') {
            let id = job.payload?.file_id;
            if (!id) {
              const imported = await bridge.call('import_file',{scope:job.scope_id,name:job.payload?.name,base64:job.payload?.base64});
              id = imported.id;
              // Clear the large bytes as soon as durable archive ID is known.
              await deps.supabaseRequest(path,{method:'PATCH',body:JSON.stringify({payload:{file_id:id,caption:job.payload?.caption || ''},updated_at:new Date().toISOString()})});
            }
            result = await bridge.call('send_file',{...args,id,caption:job.payload?.caption});
          } else throw Error('Unsupported request kind');
          accepted = result.accepted === true;
          await deps.supabaseRequest(path,{method:'PATCH',body:JSON.stringify({status:'accepted',result,error:null,updated_at:new Date().toISOString()})});
          console.log('Owner outbox accepted',job.id,job.scope_id);
        } catch (e) {
          // A receipt-write failure after LINE accepted must never turn into a
          // failed/requeued send. Leave sending for manual reconciliation.
          if (accepted) throw Error('Accepted send needs receipt reconciliation: ' + job.id);
          const safe = /^(Invalid |Missing |Request |Destination |LINE |Unsupported |Stored |Group )/.test(e.message) ? e.message : 'Operation failed; no automatic retry';
          await deps.supabaseRequest(path,{method:'PATCH',body:JSON.stringify({status:'failed',error:safe,updated_at:new Date().toISOString()})});
          console.error('Owner outbox failed',job.id,safe);
        }
      }
    } finally { busy = false; }
  }
  return {tick};
}
module.exports = {createOutbox};
