/* 缶ログ: UI orchestration. Calculations and validation stay in beer-core.js. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const B=window.BeerLog,S=window.BeerStore;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const decimal=n=>Number(n.toFixed(1)).toLocaleString('ja-JP');
  const money=n=>Number(n.toFixed(2)).toLocaleString('ja-JP')+'円';
  const now=()=>new Date().toISOString();
  const localInput=iso=>new Date(Date.parse(iso)+9*3600000).toISOString().slice(0,16);
  const localIso=value=>{if(!value)throw Error('日時を入力してください');return value+':00+09:00';};
  const stamp=(iso,full=false)=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',...(full?{month:'numeric',day:'numeric'}:{}),hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
  const duration=min=>Math.floor(min/60)+'時間'+(min%60?min%60+'分':'');
  const optional=id=>$(id).value.trim()===''?null:Number($(id).value);
  let repo=null,state=null,selectedId=null,editingProductId=null,productBase={},editingDrinkId=null,editSnapshot=null,editingSessionId=null;
  let imported=null,undo=null,blocked=false,busyUntil=0,currentView='home',cursor=null,selectedDay=null;
  function note(message,error=false){$('status').hidden=false;$('status').textContent=message;$('status').classList.toggle('error',error);}
  function guard(fn,errorId=null){
    if(errorId)$(errorId).hidden=true;
    try{return fn();}catch(e){
      const message=e.message||'処理できませんでした。JSONバックアップを確認してください。';
      if(errorId){$(errorId).textContent=message;$(errorId).hidden=false;}else note(message,true);
      return null;
    }
  }
  function ensureWrite(){if(blocked||!repo||!state)throw Error('元の記録を保護するため保存を停止しています。JSONを退避し、再読み込みしてください。');}
  function commit(next,message,undoLabel=null){
    ensureWrite();const before=state;
    const saved=repo.commit(next,true); // Atomic primary write; memory changes only on success.
    state=saved;undo=undoLabel?{before,after:B.serialize(saved),label:undoLabel}:null;
    render();if(message)note(message);
  }
  function open(id){const dialog=$(id);if(!dialog.open)dialog.showModal();}
  function close(id){if($(id).open)$(id).close();}
  function future(iso){if(Date.parse(iso)>Date.now()+60000)throw Error('未来の日時は保存できません');}
  function switchView(view){
    currentView=view;
    for(const v of ['home','history','analysis','settings'])$(v+'View').hidden=v!==view;
    for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-selected',String(b.dataset.view===view));
    window.scrollTo({top:0,behavior:'instant'});
  }
  function download(name,content,type='application/json'){
    const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function exportJson(){if(!state)throw Error('保存原文を退避してください');download('缶ログ_backup_'+B.currentDay(state)+'_'+Date.now()+'.json',B.serialize(state));}
  function productLabel(p){return p.productName+' / '+p.volumeMl+'mL / '+p.alcoholPercent+'%';}
  function availableProducts(){return state.products.filter(p=>!p.archived);}
  function productOptions(first='銘柄を選択'){return '<option value="">'+first+'</option>'+availableProducts().map(p=>`<option value="${esc(p.id)}">${esc(productLabel(p))}</option>`).join('');}
  function pick(pid){if(!availableProducts().some(p=>p.id===pid))return;selectedId=pid;renderHome();close('productPicker');}
  function renderPicker(){
    const products=availableProducts();
    $('pickerProducts').innerHTML=products.length?products.map(p=>`<button type="button" data-pick="${esc(p.id)}"><strong>${esc(p.productName)}</strong><small>${p.volumeMl}mL / ${p.alcoholPercent}%${p.id===selectedId?' · 選択中':''}</small></button>`).join(''):'<p class="empty">選べるお酒がありません。<br>バーコードか手動で登録できます。削除した銘柄は設定から戻せます。</p>';
  }
  function timeline(drinks){
    return drinks.length?[...drinks].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(d=>`<button type="button" class="logEntry" data-edit="${esc(d.id)}"><span class="logTime">${esc(stamp(d.startedAt))}</span><span class="logInfo"><strong>${esc(d.snapshot.productName)}</strong><small>${d.snapshot.volumeMl}mL · ${d.snapshot.alcoholPercent}% · 1本 · ${decimal(d.pureAlcoholGrams)}g</small><small>${d.purchasePriceYen===null?'価格未入力':money(d.purchasePriceYen)}${d.allocation==='included'?' · 旧本数の内訳':''}</small></span><span class="chevron" aria-hidden="true">›</span></button>`).join(''):'<p class="empty">まだ記録はありません。<br>飲み始めに、ひとタップ。</p>';
  }
  function sessionHTML(s){
    const summary=B.sessionSummary(state,s.id),estimate=summary.estimate;
    const elapsed=Math.max(0,Math.floor(((s.finishedAt?Date.parse(s.finishedAt):Date.now())-Date.parse(s.startedAt))/60000));
    return `<div class="timing"><div><small>飲酒開始</small><strong>${esc(stamp(s.startedAt,true))}</strong></div><div><small>${s.finishedAt?'飲酒時間':'経過時間'}</small><strong>${duration(elapsed)}</strong></div></div><p class="eyebrow">${s.finishedAt?'今回の飲酒':'飲酒中'} · ${summary.count}本 / ${decimal(summary.grams)}g</p><small>推定分解終了の目安</small><p class="estimateTime">${esc(stamp(estimate.finishedAt,true))}</p><p class="hint">全量を分解する参考時間 約${duration(estimate.totalMinutes)}。飲み始めの時刻と缶の間隔を考慮した推定です。</p><p class="hint">個人差が大きく、アルコールの消失や運転できる時刻を保証しません。同じセッションの詳細登録分のみが対象です。</p>`;
  }
  function renderHome(){
    const day=B.currentDay(state),a=B.aggregate(state,k=>k===day),active=B.activeSession(state);
    const chosen=availableProducts().find(p=>p.id===selectedId);
    $('selectedName').textContent=chosen?chosen.productName:'いつものお酒を選びましょう';
    $('selectedFacts').textContent=chosen?chosen.volumeMl+'mL / '+chosen.alcoholPercent+'%':'まずは銘柄を登録してください';
    $('sessionBadge').textContent=active?'飲酒中':'飲酒前';
    $('sessionCount').hidden=!active;$('sessionCountNumber').textContent=active?B.sessionSummary(state,active.id).count:'0';
    $('startBtn').hidden=!!active;$('addBtn').hidden=!active;$('finishBtn').hidden=!active;
    const last=active?state.drinks.filter(d=>d.sessionId===active.id).at(-1):null;
    $('addBtn').textContent=!chosen?'銘柄を選んで1本追加':last&&selectedId!==last.productId?'この銘柄を1本追加':'＋1本';
    $('actionHint').textContent=active?'新しい缶を飲み始めたら、押してください':'スタートで、選んだ銘柄の1本目を記録';
    for(const id of ['startBtn','addBtn'])$(id).disabled=blocked||Date.now()<busyUntil;
    $('todayDate').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'long',day:'numeric',weekday:'short'}).format(new Date());
    $('dayBoundaryHint').textContent=(state.settings.dayStartHour?state.settings.dayStartHour+'時区切り · ':'')+day.slice(5).replace('-',' / ');
    $('todayMetrics').innerHTML=`<div class="metric"><small>飲んだ本数</small><strong>${a.count}<span>本</span></strong><small>${a.unknownDetails?'うち銘柄未登録 '+a.unknownDetails+'本':'本日の合計'}</small></div><div class="metric"><small>純アルコール</small><strong>${a.alcohol.unknown===a.count&&a.count?'—':decimal(a.alcohol.value)}<span>g</span></strong><small>${a.alcohol.unknown?'未確認 '+a.alcohol.unknown+'本を除く':'容量 × 度数 × 0.8'}</small></div>`;
    const recent=B.recentProducts(state);
    $('recentProducts').innerHTML=recent.length?recent.map(p=>`<button type="button" class="recentProduct ${p.id===selectedId?'selected':''}" data-pick="${esc(p.id)}" aria-pressed="${p.id===selectedId}">${esc(p.productName)}<span>${p.volumeMl}mL · ${p.alcoholPercent}%</span></button>`).join(''):'<p class="hint" style="grid-column:1/-1">飲んだお酒から、最近の3銘柄が並びます。</p>';
    const latest=active||[...state.sessions].filter(s=>state.drinks.some(d=>d.sessionId===s.id&&B.recordDay(d)===day)).sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0];
    $('sessionSummary').hidden=!latest;
    $('sessionSummary').innerHTML=latest?sessionHTML(latest):'';
    $('todayTimeline').innerHTML=timeline(state.drinks.filter(d=>B.recordDay(d)===day));
    $('sessionReminder').hidden=!(active&&(B.dayKey(active.startedAt)!==B.dayKey(now())||Date.now()-Date.parse(active.startedAt)>86400000));
    $('undoBar').hidden=!undo;if(undo)$('undoText').textContent=undo.label;
  }
  function renderHistory(){
    const days=[...new Set([...Object.keys(state.countOnlyRecords),...state.drinks.map(B.recordDay)])].sort().reverse();
    $('history').innerHTML=days.length?days.map(day=>{const a=B.aggregate(state,k=>k===day);return `<div class="historyDay"><div class="row"><h3>${esc(day)} · ${a.count}本</h3><button class="textButton" data-count="${day}">本数を修正</button></div>${a.unknownDetails?'<p class="hint">本数のみ '+a.unknownDetails+'本。商品・アルコール量は未確認です。</p>':''}<div class="timeline">${timeline(state.drinks.filter(d=>B.recordDay(d)===day))}</div></div>`;}).join(''):'<p class="empty">記録したお酒は、ここに並びます。</p>';
    $('sessionHistory').innerHTML=state.sessions.length?[...state.sessions].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(s=>`<details class="sessionItem"><summary>${esc(stamp(s.startedAt,true))}から · ${B.sessionSummary(state,s.id).count}本 · ${s.finishedAt?'終了':'終了未記録'}</summary>${sessionHTML(s)}<p class="hint">${s.finishedAt?'飲酒終了 '+esc(stamp(s.finishedAt,true)):'終了日時はまだ保存されていません。'}</p><button data-session="${esc(s.id)}">開始・終了日時を修正</button></details>`).join(''):'<p class="hint">旧記録は日別履歴に保持しています。セッションは推測で作りません。</p>';
    $('countDay').max=B.currentDay(state);
  }
  function renderAnalysis(){
    const day=B.currentDay(state),period=$('period').value;
    const monday=B.dayKey(new Date(Date.parse(day+'T12:00:00+09:00')-((new Date(day+'T12:00:00+09:00').getUTCDay()+6)%7)*86400000).toISOString());
    const predicate=k=>period==='all'||(period==='day'?k===day:period==='week'?k>=monday&&k<=day:k.startsWith(day.slice(0,period==='month'?7:4)));
    const a=B.aggregate(state,predicate),days=new Set(state.drinks.map(B.recordDay).filter(predicate));
    for(const [key,count] of Object.entries(state.countOnlyRecords))if(predicate(key)&&count>0)days.add(key);
    const items=[['飲んだ本数',a.count,'本'],['純アルコール',a.alcohol.unknown===a.count&&a.count?'—':decimal(a.alcohol.value),'g'],['飲酒日数',days.size,'日'],['消費したお酒の金額',a.spending.unknown===a.count&&a.count?'—':money(a.spending.value),'']];
    $('analysisMetrics').innerHTML=items.map(([label,value,unit],i)=>`<div class="metric"><small>${label}</small><strong style="font-size:${i===3?'25':'32'}px">${value}<span>${unit}</span></strong><small>${i===1&&a.alcohol.unknown?'未確認 '+a.alcohol.unknown+'本を除く':i===3&&a.spending.unknown?'価格未入力 '+a.spending.unknown+'本を除く':i===2?'1本以上記録した日':'記録した分の合計'}</small></div>`).join('');
    $('periodLabel').textContent=period==='week'?monday+' 〜 '+day:period==='all'?'全期間の記録':period==='day'?day:day.slice(0,period==='month'?7:4);
    const ranks=new Map();
    for(const d of state.drinks.filter(d=>predicate(B.recordDay(d)))){const key=B.fingerprint(d.snapshot);if(!ranks.has(key))ranks.set(key,{p:d.snapshot,count:0});ranks.get(key).count++;}
    $('rankings').innerHTML=ranks.size?[...ranks.values()].sort((a,b)=>b.count-a.count).slice(0,10).map(x=>`<div class="productRow"><div><strong>${esc(x.p.productName)}</strong><small>${x.p.volumeMl}mL / ${x.p.alcoholPercent}%</small></div><b>${x.count}本</b></div>`).join(''):'<p class="hint">銘柄の記録が増えると表示します。</p>';
    const all=B.aggregate(state);$('savings').textContent='累計 '+money(all.savings)+' / 基準 '+state.settings.baseline+'本・目標 '+state.settings.target+'本 / 基準価格 '+money(state.settings.price);
    renderCalendar();
  }
  function renderCalendar(){
    const [y,m]=cursor.split('-').map(Number),first=new Date(Date.UTC(y,m-1,1)).getUTCDay(),last=new Date(Date.UTC(y,m,0)).getUTCDate();
    $('monthLabel').textContent=y+'年'+m+'月';
    let html=['日','月','火','水','木','金','土'].map(d=>'<span class="dow">'+d+'</span>').join('')+'<span></span>'.repeat(first);
    for(let d=1;d<=last;d++){const key=cursor+'-'+String(d).padStart(2,'0'),a=B.aggregate(state,k=>k===key);html+=`<button data-day="${key}" class="${a.recordedDays?'has':''}" aria-label="${key} ${a.count}本">${d}<b>${a.recordedDays?a.count+'本':'–'}</b></button>`;}
    $('calendar').innerHTML=html;
    $('calendarDetail').innerHTML=selectedDay?`<h3 style="margin-top:14px">${selectedDay} · ${B.aggregate(state,k=>k===selectedDay).count}本</h3>`+timeline(state.drinks.filter(d=>B.recordDay(d)===selectedDay)):'';
  }
  function renderSettings(){
    const products=availableProducts(),archived=state.products.filter(p=>p.archived);
    $('productList').innerHTML=products.length?products.map(p=>`<div class="productRow"><div><strong>${esc(p.productName)}</strong><small>${p.volumeMl}mL / ${p.alcoholPercent}%<br>参考単価 ${p.referencePriceYen===null?'未入力':money(p.referencePriceYen)}</small></div><div class="productActions"><button data-product-edit="${esc(p.id)}" class="write">編集</button><button data-product-delete="${esc(p.id)}" class="write danger" aria-label="${esc(productLabel(p))}を一覧から削除">削除</button></div></div>`).join(''):'<p class="hint">選べる銘柄はありません。新しく登録するか、削除した銘柄を元に戻せます。</p>';
    $('archivedProducts').hidden=!archived.length;
    $('archivedProductsTitle').textContent='削除した銘柄（'+archived.length+'件）';
    $('archivedProductList').innerHTML=archived.map(p=>`<div class="productRow"><div><strong>${esc(p.productName)}</strong><small>${p.volumeMl}mL / ${p.alcoholPercent}%</small></div><button data-product-restore="${esc(p.id)}" class="write">元に戻す</button></div>`).join('');
    $('metabolismRate').value=state.settings.metabolismGramsPerHour;
    $('dayStartHour').value=String(state.settings.dayStartHour);
    for(const k of ['baseline','target','price'])$(k).value=state.settings[k];
  }
  function render(){
    if(!state)return;
    if(!availableProducts().some(p=>p.id===selectedId))selectedId=B.recentProducts(state)[0]?.id||availableProducts()[0]?.id||null;
    renderHome();renderHistory();renderAnalysis();renderSettings();renderPicker();
    for(const el of document.querySelectorAll('.write'))if(blocked)el.disabled=true;
  }
  function fillProduct(p={}){
    productBase={...p};
    for(const k of ['janCode','productName','volumeMl','alcoholPercent','manufacturer','referencePriceYen','caloriesKcal','revision'])$(k).value=p[k]??'';
    $('category').value=p.category||'other';
  }
  function openProduct(p={},editing=false,message=''){
    ensureWrite();close('productPicker');editingProductId=editing?p.id:null;
    fillProduct(p);$('productTitle').textContent=editing?'お酒の商品情報を編集':'お酒を登録';
    $('productError').hidden=true;$('barcodeNote').textContent=message;$('barcodeChoices').replaceChildren();open('productDialog');
  }
  function lookupJan(){
    const plan=window.KanBarcode.lookup($('janCode').value,state.products,window.BeerCatalog?.products||[]);
    $('barcodeChoices').replaceChildren();
    const apply=p=>{fillProduct({...p,janCode:plan.janCode});$('barcodeChoices').replaceChildren();$('barcodeNote').textContent=plan.reviewReason||'缶の商品名・容量・度数を確認して保存してください。まだ飲酒は記録していません。';};
    if(plan.candidates.length===1)apply(plan.candidates[0]);
    else{
      // Do not leave the previous product's fields attached to an unknown JAN.
      fillProduct({janCode:plan.janCode});
      $('barcodeNote').textContent=plan.candidates.length?'複数の商品があります。缶の表示に一致するものを選んでください。':'未登録のJANです。商品名・容量・度数を入力してください。';
      for(const p of plan.candidates){const button=document.createElement('button');button.type='button';button.textContent=productLabel(p);button.onclick=()=>apply(p);$('barcodeChoices').append(button);}
    }
  }
  function openEdit(did){
    ensureWrite();const d=state.drinks.find(x=>x.id===did);if(!d)throw Error('記録が見つかりません');editingDrinkId=did;editSnapshot={...d.snapshot};
    $('editSavedProduct').innerHTML=productOptions('この記録の商品情報を使う');$('editSavedProduct').value='';
    fillEditFields(d.snapshot);$('editStartedAt').value=localInput(d.startedAt);$('editPrice').value=d.purchasePriceYen??'';
    $('detachLabel').hidden=d.allocation!=='included';$('detachIncluded').checked=false;$('editError').hidden=true;open('editDialog');
  }
  function fillEditFields(p){$('editName').value=p.productName;$('editVolume').value=p.volumeMl;$('editAlcohol').value=p.alcoholPercent;}
  function openSession(sid){
    ensureWrite();const s=state.sessions.find(x=>x.id===sid);if(!s)throw Error('セッションが見つかりません');editingSessionId=sid;
    $('sessionStartedAt').value=localInput(s.startedAt);$('sessionFinishedAt').value=s.finishedAt?localInput(s.finishedAt):'';$('sessionError').hidden=true;open('sessionDialog');
  }
  function openPast(){
    ensureWrite();$('pastProduct').innerHTML=productOptions();$('pastProduct').value=selectedId||'';
    $('pastSession').innerHTML='<option value="">セッションに含めない</option>'+[...state.sessions].sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(s=>`<option value="${esc(s.id)}">${esc(stamp(s.startedAt,true))}から · ${s.finishedAt?'終了':'未終了'}</option>`).join('');
    $('pastStartedAt').value=localInput(new Date(Date.now()-86400000).toISOString());$('pastPrice').value='';$('pastIncluded').checked=false;$('pastError').hidden=true;open('pastDialog');
  }
  function quick(start){
    if(Date.now()<busyUntil)return;
    ensureWrite();if(!selectedId){open('productPicker');return;}
    const next=B.addFromProduct(state,selectedId,now(),{start});
    busyUntil=Date.now()+800;
    commit(next,start?'飲酒を始めました。1本目を記録しました。':'1本を追加しました。',start?'1本目を記録しました':'1本を追加しました');
    setTimeout(()=>{if(state)renderHome();},850);
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.close)close(button.dataset.close);
    if(button.dataset.view)switchView(button.dataset.view);
    if(!state)return;
    guard(()=>{
      if(button.dataset.pick)pick(button.dataset.pick);
      if(button.dataset.edit)openEdit(button.dataset.edit);
      if(button.dataset.productEdit)openProduct(state.products.find(p=>p.id===button.dataset.productEdit),true);
      if(button.dataset.productDelete)commit(B.archiveProduct(state,button.dataset.productDelete),'銘柄を一覧から削除しました。過去の飲酒記録は残っています。「削除した銘柄」から元に戻せます。','銘柄を一覧から削除しました');
      if(button.dataset.productRestore)commit(B.archiveProduct(state,button.dataset.productRestore,false),'銘柄を一覧に戻しました。');
      if(button.dataset.session)openSession(button.dataset.session);
      if(button.dataset.day){selectedDay=button.dataset.day;renderCalendar();}
      if(button.dataset.count){$('countDay').value=button.dataset.count;$('dayCount').value=B.aggregate(state,k=>k===button.dataset.count).count;$('countForm').closest('details').open=true;$('countForm').scrollIntoView({block:'center'});}
    });
  });
  $('startBtn').onclick=()=>guard(()=>quick(true));$('addBtn').onclick=()=>guard(()=>quick(false));
  $('finishBtn').onclick=()=>guard(()=>{const s=B.activeSession(state);if(!s)return;commit(B.finish(state,now(),s.id),'飲酒の終了を記録しました。','飲酒を終了しました');});
  $('undoBtn').onclick=()=>guard(()=>{if(!undo)return;if(B.serialize(state)!==undo.after)throw Error('記録が変わったため取り消せません。履歴から修正してください');const before=undo.before;busyUntil=0;commit(before,'直前の操作を取り消しました。');});
  $('reviewActive').onclick=()=>guard(()=>openSession(B.activeSession(state)?.id));
  for(const id of ['chooseProduct','allProducts'])$(id).onclick=()=>guard(()=>{ensureWrite();renderPicker();open('productPicker');});
  for(const id of ['manualProduct','pickerManual','newProduct'])$(id).onclick=()=>guard(()=>openProduct());
  $('lookupJan').onclick=()=>guard(lookupJan,'productError');
  $('productForm').onsubmit=event=>{event.preventDefault();guard(()=>{
    const input={...productBase};
    for(const k of ['janCode','productName','manufacturer','category','revision'])input[k]=$(k).value;
    input.volumeMl=Number($('volumeMl').value);input.alcoholPercent=Number($('alcoholPercent').value);input.caloriesKcal=optional('caloriesKcal');input.referencePriceYen=optional('referencePriceYen');
    const next=B.saveProduct(state,input,editingProductId);
    const target=next.products.find(p=>B.fingerprint(p)===B.fingerprint(B.product(input))).id;
    // Select only after a successful storage write, so failed saves cannot leak UI state.
    commit(next,'商品を保存しました。飲酒スタートで1本目を記録できます。');selectedId=target;renderHome();close('productDialog');
  },'productError');};
  $('editSavedProduct').onchange=()=>{const p=state.products.find(p=>p.id===$('editSavedProduct').value);editSnapshot={...(p||state.drinks.find(d=>d.id===editingDrinkId).snapshot)};fillEditFields(editSnapshot);};
  $('editForm').onsubmit=event=>{event.preventDefault();guard(()=>{
    const d=state.drinks.find(x=>x.id===editingDrinkId),when=$('editStartedAt').value===localInput(d.startedAt)?d.startedAt:localIso($('editStartedAt').value);future(when);
    const product={...editSnapshot,productName:$('editName').value,volumeMl:Number($('editVolume').value),alcoholPercent:Number($('editAlcohol').value)};
    if(product.productName!==editSnapshot.productName||product.volumeMl!==editSnapshot.volumeMl||product.alcoholPercent!==editSnapshot.alcoholPercent){product.janCode='';product.caloriesKcal=null;product.sugarGrams=null;product.source='';}
    commit(B.editDrink(state,editingDrinkId,{product,startedAt:when,purchasePriceYen:optional('editPrice'),detachIncluded:$('detachIncluded').checked}),'この1本の記録を更新しました。','記録を編集しました');close('editDialog');
  },'editError');};
  $('deleteDrink').onclick=()=>guard(()=>{commit(B.remove(state,editingDrinkId),'詳細記録を削除しました。旧本数の内訳の場合、元の本数は保持します。','詳細記録を削除しました');close('editDialog');},'editError');
  $('sessionEditForm').onsubmit=event=>{event.preventDefault();guard(()=>{
    const s=state.sessions.find(x=>x.id===editingSessionId);
    const start=$('sessionStartedAt').value===localInput(s.startedAt)?s.startedAt:localIso($('sessionStartedAt').value);
    const end=$('sessionFinishedAt').value?($('sessionFinishedAt').value===(s.finishedAt?localInput(s.finishedAt):'')?s.finishedAt:localIso($('sessionFinishedAt').value)):null;
    future(start);if(end)future(end);
    commit(B.editSession(state,s.id,{startedAt:start,finishedAt:end}),'飲酒日時を修正しました。','飲酒日時を修正しました');close('sessionDialog');
  },'sessionError');};
  $('pastDrink').onclick=()=>guard(openPast);
  $('pastForm').onsubmit=event=>{event.preventDefault();guard(()=>{
    const p=state.products.find(p=>p.id===$('pastProduct').value);if(!p)throw Error('先にホームか設定から商品を登録してください');
    const startedAt=localIso($('pastStartedAt').value);future(startedAt);
    const next=B.addPast(state,{...p,startedAt,purchasePriceYen:optional('pastPrice'),allocation:$('pastIncluded').checked?'included':'additional'},$('pastSession').value||null);
    commit(next,'過去の1本を記録しました。','過去の1本を追加しました');close('pastDialog');
  },'pastError');};
  $('countForm').onsubmit=event=>{event.preventDefault();guard(()=>{const key=$('countDay').value;if(key>B.currentDay(state))throw Error('未来の日付は保存できません');commit(B.setDailyTotal(state,key,Number($('dayCount').value)),'合計本数を保存しました。','合計本数を変更しました');});};
  $('estimateForm').onsubmit=event=>{event.preventDefault();guard(()=>{const next=structuredClone(state);next.settings.metabolismGramsPerHour=Number($('metabolismRate').value);commit(B.canonical(next),'推定の計算条件を保存しました。');});};
  $('dayBoundaryForm').onsubmit=event=>{event.preventDefault();guard(()=>{const next=structuredClone(state);next.settings.dayStartHour=Number($('dayStartHour').value);commit(B.canonical(next),'これからの集計日の区切りを変更しました。過去の記録日は保持します。');});};
  $('settingsForm').onsubmit=event=>{event.preventDefault();guard(()=>{const next=structuredClone(state);for(const k of ['baseline','target','price'])next.settings[k]=Number($(k).value);const valid=B.canonical(next);if(!confirm('以前の節約額も新しい設定で再計算されます。変更しますか？'))return;commit(valid,'節約の設定を保存しました。');});};
  $('period').onchange=()=>guard(renderAnalysis);
  for(const [id,delta] of [['prevMonth',-1],['nextMonth',1]])$(id).onclick=()=>guard(()=>{const [y,m]=cursor.split('-').map(Number);cursor=new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7);selectedDay=null;renderCalendar();});
  $('exportJson').onclick=()=>guard(exportJson);
  $('exportCsv').onclick=()=>guard(()=>download('缶ログ_'+B.currentDay(state)+'.csv',B.csv(state),'text/csv;charset=utf-8'));
  $('exportRaw').onclick=()=>guard(()=>{const raw=localStorage.getItem(S?.KEY||'beer_save_pwa_v2');if(raw===null)throw Error('保存された原文はありません');download('缶ログ_保存原文.json',raw);});
  $('exportRecovery').onclick=()=>guard(()=>{const raw=localStorage.getItem((S?.KEY||'beer_save_pwa_v2')+'_recovery');if(raw===null)throw Error('直前の回復用データはありません');download('缶ログ_直前の回復用.json',raw);});
  $('exportLegacy').onclick=()=>guard(()=>{const raw=localStorage.getItem(S?.OLD_KEY||'beer_save_pwa_v1');if(raw===null)throw Error('旧形式の記録はありません');download('缶ログ_旧形式原本.json',raw);});
  function stageImport(raw){
    imported=null;$('importActions').hidden=true;
    const decoded=B.decode(raw),a=B.aggregate(decoded);
    $('importSummary').textContent='読み込み候補：'+a.count+'本 / '+decoded.drinks.length+'件の詳細 / '+decoded.products.length+'商品。まだ保存していません。';
    imported=decoded;$('importActions').hidden=false;
  }
  $('readLegacy').onclick=()=>guard(()=>{const raw=localStorage.getItem(S.OLD_KEY);if(raw===null)throw Error('このサイト・ブラウザには旧記録がありません');stageImport(raw);});
  $('checkImport').onclick=()=>guard(()=>stageImport($('importText').value));
  $('importFile').onchange=async()=>{
    imported=null;$('importActions').hidden=true;
    try{const file=$('importFile').files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('10MB以下のJSONを選んでください');stageImport(await file.text());}
    catch(e){note(e.message,true);}finally{$('importFile').value='';}
  };
  for(const [id,merge] of [['mergeImport',true],['replaceImport',false]])$(id).onclick=()=>guard(()=>{
    ensureWrite();if(!imported)throw Error('先にバックアップを読み込んでください');
    const next=merge?B.merge(state,imported):B.canonical(imported);
    if(!confirm(merge?'バックアップを統合しますか？現在のJSONを先に保存します。':'現在の記録をバックアップの内容に復元しますか？現在のJSONを先に保存します。'))return;
    exportJson();commit(next,merge?'バックアップを統合しました。':'バックアップから復元しました。');imported=null;$('importActions').hidden=true;
  });
  for(let h=0;h<=23;h++){const option=document.createElement('option');option.value=h;option.textContent=h+'時';$('dayStartHour').append(option);}
  guard(()=>{
    if(!B||!S||B.empty().version!==6)throw Error('アプリの更新を読み込めません。再読み込みしてください。記録は変更していません。');
    repo=S.open(localStorage);state=repo.get();blocked=repo.hasConflict();
    cursor=B.currentDay(state).slice(0,7);$('countDay').value=B.currentDay(state);$('dayCount').value=B.aggregate(state,k=>k===B.currentDay(state)).count;
    const cat=window.BeerCatalog;
    $('beerCatalogInfo').textContent=cat?'JAN '+cat.products.length+'件 / 確認 '+(cat.autoUpdate?.checkedOn||cat.verifiedOn)+'。辞書にない商品は手動で登録できます。容量や度数は缶の表示を確認してください。':'商品辞書を読み込めませんでした。手動登録は利用できます。';
    if(blocked)note('旧画面から記録が変更されています。JSONを退避して内容を確認してください。保存は停止しています。',true);
    render();
    const barcode=window.KanBarcode.create({getState:()=>state,catalog:cat?.products||[],onReview:(p,message)=>guard(()=>openProduct(p,false,message))});
    for(const id of ['beerLiveButton','pickerBarcode'])$(id).onclick=()=>guard(()=>{ensureWrite();close('productPicker');barcode.start();});
  });
  if(!state){blocked=true;for(const el of document.querySelectorAll('.write'))el.disabled=true;switchView('settings');}
  window.addEventListener('storage',event=>{if(!event.key||[S?.KEY,S?.OLD_KEY].includes(event.key)){blocked=true;render();note('別の画面で記録が更新されました。再読み込みしてから操作してください。保存は停止しています。',true);}});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state)renderHome();});
  setInterval(()=>{if(state&&currentView==='home'&&!document.querySelector('dialog[open]'))renderHome();},30000);
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))navigator.serviceWorker.register('./sw.js').catch(()=>note('オフライン用の準備ができませんでした。通信のある状態で再読み込みしてください。',true));
})();
