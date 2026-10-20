(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./beer-recognition.js'));
  else root.KanBarcode=factory(root.BeerRecognition);
})(typeof window!=='undefined'?window:globalThis,function(R){
  'use strict';
  function lookup(code,products,catalog){
    const jan=R.jan(code);if(!jan)throw Error('有効な8桁または13桁のJAN / EANコードを入力してください');
    const plan=R.plan('',jan,products,catalog);
    // Recognition is advisory. Product registration and drinking are separate.
    return {janCode:jan,candidates:plan.candidates,requiresConfirmation:plan.conflict,reviewReason:plan.reviewReason};
  }
  function create({getState,onReview,catalog=[]}){
    const $=id=>document.getElementById(id),dialog=$('beerLiveDialog');
    let token=0,pending=null,selected=null,library=null;
    const scanner=window.BeerLiveBarcode.create({video:$('beerLiveVideo'),preview:$('beerLivePreview'),
      onState(kind,message){$('beerLiveStatus').textContent=message;$('beerLiveViewport').dataset.state=kind;$('beerLiveVideo').hidden=kind==='detected';$('beerLivePreview').hidden=kind!=='detected';},
      onDetected:detected});
    function error(e){$('beerLiveStatus').textContent=e.message||'読み取れませんでした。JANを手入力できます。';}
    function clear(){pending=null;selected=null;$('beerLiveResult').hidden=true;$('beerLiveChoices').replaceChildren();}
    function close(){token++;scanner.stop();clear();if(dialog.open)dialog.close();$('beerLivePreview').width=1;$('beerLivePreview').height=1;}
    function detected(code){
      try{
        pending=lookup(code,getState().products,catalog);selected=pending.candidates.length===1?pending.candidates[0]:null;
        $('beerLiveResult').hidden=false;$('beerLiveStatus').textContent='バーコードを読み取りました';$('beerLiveCode').textContent='JAN '+pending.janCode;
        $('beerLiveChoices').replaceChildren();
        if(selected){showProduct(selected);}else{
          $('beerLiveProduct').textContent=pending.candidates.length?'該当する商品を選んでください':'未登録の商品です';
          $('beerLiveFacts').textContent=pending.candidates.length?'缶の容量・度数を確認して選んでください。':'JANを引き継いで、商品名・容量・度数を入力できます。';
          for(const p of pending.candidates){const b=document.createElement('button');b.type='button';b.textContent=p.productName+' / '+p.volumeMl+'mL / '+p.alcoholPercent+'%';b.onclick=()=>{selected=p;showProduct(p);};$('beerLiveChoices').append(b);}
        }
        $('beerLiveConfirm').disabled=pending.candidates.length>1&&!selected;
        $('beerLiveConfirm').textContent=pending.candidates.length?'商品情報を確認する':'手動で商品を登録する';
      }catch(e){error(e);}
    }
    function showProduct(p){$('beerLiveProduct').textContent=p.productName;$('beerLiveFacts').textContent=p.volumeMl+'mL / '+p.alcoholPercent+'%'+(pending.requiresConfirmation?'・仕様変更の可能性があります。缶の表示を確認してください。':'');$('beerLiveConfirm').disabled=false;}
    async function start(){
      token++;scanner.stop();clear();$('beerLiveVideo').hidden=false;$('beerLivePreview').hidden=true;
      if(!dialog.open)dialog.showModal();await scanner.start();
    }
    $('beerLiveClose').onclick=close;
    $('beerLiveRetry').onclick=start;
    dialog.addEventListener('cancel',close);
    dialog.addEventListener('close',()=>{token++;scanner.stop();clear();});
    $('beerLiveConfirm').onclick=()=>{if(!pending||(pending.candidates.length>1&&!selected))return;const value=selected?{...selected,janCode:pending.janCode}:{janCode:pending.janCode};const note=pending.reviewReason;close();onReview(value,note);};
    $('barcodeManual').onclick=()=>{close();onReview({},'JANコードを手入力して照合できます。');};
    async function loadLibrary(){
      if(window.ZXingBrowser)return;
      if(!library)library=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL('./vendor/zxing-browser-0.2.1.min.js',document.baseURI).href;s.onload=resolve;s.onerror=()=>{library=null;s.remove();reject(Error('読み取り機能を準備できませんでした'));};document.head.append(s);});
      await library;
    }
    $('barcodeFile').onchange=async()=>{
      const file=$('barcodeFile').files[0];$('barcodeFile').value='';if(!file)return;
      token++;const current=token;scanner.stop();clear();let url=null;
      try{
        if(!file.type.startsWith('image/')||file.size>12*1024*1024)throw Error('12MB以下のバーコード画像を選んでください');
        $('beerLiveStatus').textContent='バーコードを読み取っています';await loadLibrary();if(current!==token)return;
        url=URL.createObjectURL(file);const reader=new window.ZXingBrowser.BrowserMultiFormatReader();
        const result=await reader.decodeFromImageUrl(url);if(current!==token)return;detected(result.getText());
      }catch(e){if(current===token)error(Error('バーコードを読み取れませんでした。数字を手入力できます。'));}
      finally{if(url)URL.revokeObjectURL(url);}
    };
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')close();});
    window.addEventListener('pagehide',close);
    return {start,close};
  }
  return {lookup,create};
});
