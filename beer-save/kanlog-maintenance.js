(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.KanMaintenance=factory();})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const VERSION='2026-10-24-notice',BACKUP_KEY='kanlog_backup_meta_v1',DAY=86400000;
  function backupMeta(raw,when=Date.now()){
    let value={};try{const parsed=JSON.parse(raw);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))value=parsed;}catch(_){}
    const past=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))&&Date.parse(x)<=when+60000;
    return {firstSeenAt:past(value.firstSeenAt)?value.firstSeenAt:new Date(when).toISOString(),lastExportAt:past(value.lastExportAt)?value.lastExportAt:null,snoozedUntil:typeof value.snoozedUntil==='string'&&Number.isFinite(Date.parse(value.snoozedUntil))&&Date.parse(value.snoozedUntil)<=when+7*DAY+60000?value.snoozedUntil:null};
  }
  function backupDue(meta,hasData,when=Date.now()){
    return !!hasData&&when-Date.parse(meta.lastExportAt||meta.firstSeenAt)>=30*DAY&&(!meta.snoozedUntil||Date.parse(meta.snoozedUntil)<=when);
  }
  function exported(meta,when=Date.now()){return {...meta,lastExportAt:new Date(when).toISOString(),snoozedUntil:null};}
  function snooze(meta,when=Date.now()){return {...meta,snoozedUntil:new Date(when+7*DAY).toISOString()};}
  function release(value){
    if(!value||typeof value!=='object'||typeof value.version!=='string'||!/^[A-Za-z0-9._-]{1,80}$/.test(value.version))return null;
    // Optional one-line summary shown with the update notice.
    return typeof value.notes==='string'&&value.notes.trim()&&value.notes.length<=200?{version:value.version,notes:value.notes.trim()}:{version:value.version};
  }
  return {VERSION,BACKUP_KEY,backupMeta,backupDue,exported,snooze,release};
});
