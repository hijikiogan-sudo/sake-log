(function(root,factory){
  if(typeof module==='object' && module.exports)module.exports=factory(require('./beer-core.js'));
  else root.BeerStore=factory(root.BeerLog);
})(typeof window!=='undefined'?window:this,function(B){
  'use strict';
  const KEY='beer_save_pwa_v2',OLD_KEY='beer_save_pwa_v1';
  function view(state){
    const keys=[...new Set([...Object.keys(state.countOnlyRecords),...state.drinks.map(d=>B.recordDay(d))])];
    const records={};for(const key of keys)records[key]=B.aggregate(state,k=>k===key).count;
    return {settings:{...state.settings},records};
  }
  function open(storage,key=KEY,oldKey=OLD_KEY){
    const repository=B.repository(storage,key),physicalOld=storage.getItem(oldKey);
    let state=storage.getItem(key)===null && physicalOld!==null?B.migrate(physicalOld):repository.get();
    const marker=state.originLegacyRaw??state.legacyRaw;
    let conflict=marker!==physicalOld && storage.getItem(key)!==null;
    function ensureFresh(){
      if(conflict || storage.getItem(oldKey)!==physicalOld)throw Error('以前の画面から旧記録が変更されています。旧記録と現在のJSONを両方保存し、内容を確認してから移行してください。自動で上書きしません。');
    }
    function commit(next,backup=false){
      ensureFresh();next=B.canonical({...next,originLegacyRaw:physicalOld});
      state=repository.commit(next,backup);return get();
    }
    function get(){return JSON.parse(JSON.stringify(state));}
    function saveCount(day,total){
      if(day>B.currentDay(state))throw Error('未来の日付には保存できません');
      return commit(B.setDailyTotal(state,day,total),true);
    }
    function deleteCount(day){
      B.validDay(day);if(state.drinks.some(d=>B.recordDay(d)===day))throw Error('この日には1缶ごとの詳細があります。先に酒ログ画面で詳細を確認・削除してください。本数だけを削除して履歴を隠すことはできません。');
      const next=get();delete next.countOnlyRecords[day];return commit(next,true);
    }
    function saveSettings(settings){return commit({...get(),settings:{...state.settings,...settings}},true);}
    function backupRaw(){return storage.getItem(key)??storage.getItem(oldKey)??B.serialize(state);}
    return {get,commit,saveCount,deleteCount,saveSettings,view:()=>view(state),backupRaw,hasConflict:()=>conflict,storageKey:key};
  }
  return {KEY,OLD_KEY,open,view};
});
