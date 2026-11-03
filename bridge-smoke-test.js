const crypto = require('node:crypto');
const {createBridge} = require('./chatgpt-file-bridge');

// Explicit opt-in for ONE owner-authorized live test, never a broadcast.
// The persistent receipt prevents resending on later server restarts.
async function run(deps,config=process.env) {
  const testId=String(config.TTM_BRIDGE_SMOKE_TEST_ID || '');
  const scope=String(config.TTM_BRIDGE_SMOKE_TEST_SCOPE || '');
  if (!testId && !scope) return {skipped:true};
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(testId) || !/^group:C[a-f0-9]{32}$/i.test(scope)) throw Error('Invalid smoke test configuration');
  const receiptPath='line_memories?id=eq.'+testId+'&scope_id=eq.'+encodeURIComponent(scope);
  let prior=(await deps.supabaseRequest(receiptPath+'&select=id,metadata,created_at&limit=1',{method:'GET'}))?.[0];
  if (prior && prior.metadata?.kind !== 'chatgpt_bridge_smoke_test') throw Error('Smoke test ID conflicts with another record');
  if (prior?.metadata?.state === 'accepted') return {skipped:true,reason:'already_accepted'};
  if (prior && (!Number.isFinite(Date.parse(prior.created_at)) || Date.now()-Date.parse(prior.created_at)>23*60*60*1000)) throw Error('Old smoke test requires manual review; will not resend');
  if (!prior) {
    await deps.supabaseRequest('line_memories?on_conflict=id',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:JSON.stringify([{id:testId,scope_id:scope,source_type:'group',group_id:scope.slice(6),message_type:'memory',text_content:'Owner-authorized single-image ChatGPT bridge test',metadata:{kind:'chatgpt_bridge_smoke_test',state:'prepared'}}])});
    prior=(await deps.supabaseRequest(receiptPath+'&select=id,metadata,created_at&limit=1',{method:'GET'}))?.[0];
    if (!prior || prior.metadata?.kind !== 'chatgpt_bridge_smoke_test') throw Error('Cannot verify persistent smoke test receipt');
    if (prior.metadata.state==='accepted') return {skipped:true,reason:'already_accepted'};
  }
  const update=async metadata=>deps.supabaseRequest(receiptPath,{method:'PATCH',prefer:'return=minimal',body:JSON.stringify({metadata:{kind:'chatgpt_bridge_smoke_test',...metadata}})});
  const bridge=createBridge(deps,{...config,TTM_CHATGPT_BRIDGE_TOKEN:crypto.randomBytes(32).toString('hex'),TTM_CHATGPT_BRIDGE_SCOPES:JSON.stringify([scope])});
  let fileId=prior.metadata.file_id;
  try {
    if (!fileId) {
      const image=await deps.createTestImage();
      const saved=await bridge.call('import_file',{scope,name:'ART_TTM_CONNECTION_TEST_'+testId+'.png',base64:image.toString('base64')});
      fileId=saved.id;
      await update({state:'stored',file_id:fileId});
    }
    const result=await bridge.call('send_file',{scope,id:fileId,request_id:testId,caption:'ทดสอบระบบ Art TTM ตามคำขอพี่เบนซ์ ไม่ใช่งานจริง\nภาพนี้ใช้ตรวจการส่งจาก ChatGPT ไปยังกลุ่ม TTM HOME DESIGN เท่านั้น\nการส่งครั้งนี้ยังไม่ใช่การยืนยันว่าการดึงกลับเข้าคลัง ChatGPT ทำงานครบแล้วครับ'});
    await update({state:'accepted',file_id:fileId,result,accepted_at:new Date().toISOString()});
    return result;
  } catch(e) {
    await update({state:'failed',file_id:fileId||null,error:'Live test failed; see restricted runtime logs',checked_at:new Date().toISOString()}).catch(()=>{});
    throw e;
  }
}
module.exports={run};
