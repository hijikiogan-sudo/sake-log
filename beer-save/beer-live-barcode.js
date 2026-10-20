(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.BeerLiveBarcode=factory(root);})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';
  let libraryTask=null;
  function readerFromPage(){
    if(root.ZXingBrowser)return Promise.resolve(makeReader());
    if(!libraryTask)libraryTask=new Promise((resolve,reject)=>{
      const script=root.document.createElement('script');let timer;
      const done=error=>{clearTimeout(timer);script.onload=null;script.onerror=null;if(error){script.remove();libraryTask=null;reject(error);}else resolve();};
      script.src=new URL('./vendor/zxing-browser-0.2.1.min.js',root.document.baseURI).href;
      script.onload=()=>done();script.onerror=()=>done(Error('読み取り機能を準備できませんでした。写真やJAN入力も利用できます。'));
      timer=setTimeout(()=>done(Error('読み取り機能の準備が時間切れになりました。')),20000);root.document.head.append(script);
    });
    return libraryTask.then(makeReader);
  }
  function makeReader(){
    const z=root.ZXingBrowser,r=new z.BrowserMultiFormatReader();
    r.possibleFormats=[z.BarcodeFormat.EAN_13,z.BarcodeFormat.EAN_8,z.BarcodeFormat.UPC_A];return r;
  }
  function cameraError(error){
    if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return 'カメラを利用できません。カメラの許可を確認するか、写真を選んで読み取ってください。';
    if(error?.name==='NotFoundError')return '利用できるカメラが見つかりません。写真を選んで読み取ることもできます。';
    if(error?.name==='NotReadableError')return 'カメラを開始できません。他のカメラアプリを閉じて再度お試しください。';
    return error?.message||'カメラを開始できませんでした。写真を選んで読み取ってください。';
  }
  function create(options){
    const video=options.video,preview=options.preview;
    const media=options.media||root.navigator?.mediaDevices;
    const getReader=options.readerFactory||readerFromPage;
    const normalize=options.normalize||((code)=>root.BeerRecognition.jan(code));
    const timer=options.setTimer||setTimeout,clear=options.clearTimer||clearTimeout;
    const now=options.now||Date.now,canvas=options.canvas||root.document.createElement('canvas');
    const emit=options.onState||(()=>{}),detected=options.onDetected||(()=>{});
    let stream=null,reader=null,frameTimer=null,limitTimer=null,serial=0,running=false,last='',hits=0,started=0,frames=0;
    function stop(){
      serial++;running=false;clear(frameTimer);clear(limitTimer);frameTimer=null;limitTimer=null;
      const old=stream;stream=null;
      if(old)for(const track of old.getTracks())try{track.stop();}catch(_){}
      try{video.pause();}catch(_){}video.srcObject=null;reader=null;last='';hits=0;
      canvas.width=1;canvas.height=1;
    }
    function error(message){stop();emit('error',message);}
    function freeze(){
      if(!preview||!video.videoWidth||!video.videoHeight)return;
      const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
      preview.width=Math.max(1,Math.round(video.videoWidth*scale));preview.height=Math.max(1,Math.round(video.videoHeight*scale));
      try{preview.getContext('2d').drawImage(video,0,0,preview.width,preview.height);}catch(_){}
    }
    function readFrame(){
      const width=video.videoWidth,height=video.videoHeight;
      if(!width||!height||video.readyState<2)return '';
      // Alternate a central strip and the full image. Sampling a strip preserves
      // narrow bars without requiring the barcode to occupy the entire frame.
      const strip=frames++%3!==2,sy=strip?Math.round(height*.28):0,sh=strip?Math.round(height*.44):height;
      const scale=Math.min(1,1280/width,1280/sh);
      canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(sh*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw Error('カメラ映像を読み取れません。写真を選んでお試しください。');
      ctx.drawImage(video,0,sy,width,sh,0,0,canvas.width,canvas.height);
      if(typeof reader?.decodeFromCanvas!=='function')throw Error('読み取り機能を準備できませんでした。');
      try{return normalize(reader.decodeFromCanvas(canvas).getText())||'';}
      catch(_){return '';}
    }
    function tick(token){
      if(!running||token!==serial)return;
      try{
        const code=readFrame();
        if(code){hits=code===last?hits+1:1;last=code;
          if(hits>=2){freeze();stop();emit('detected','バーコードを読み取りました');detected(code);return;}
          emit('confirming','バーコードを検出しました。確認しています…');
        }else{last='';hits=0;emit('searching',now()-started>10000?'読み取り中です。反射を避け、バーコード全体を枠に入れてください。':'読み取り中… バーコード全体を枠に入れてください');}
      }catch(e){error(cameraError(e));return;}
      if(running&&token===serial)frameTimer=timer(()=>tick(token),250);
    }
    async function start(){
      stop();const token=serial;running=true;started=now();frames=0;
      emit('starting','カメラを準備しています。初回はカメラの利用を許可してください。');
      if(root.isSecureContext===false||!media?.getUserMedia){error('この画面ではカメラを利用できません。写真を選ぶ方法をお使いください。');return;}
      limitTimer=timer(()=>{if(running&&token===serial)error('読み取りを停止しました。カメラを向け直して再度お試しください。');},60000);
      try{
        const next=await media.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        if(!running||token!==serial){for(const t of next.getTracks())t.stop();return;}
        stream=next;video.muted=true;video.setAttribute('playsinline','');video.srcObject=stream;
        await video.play();
        if(!running||token!==serial)return;
        const nextReader=await getReader();
        if(!running||token!==serial)return;
        reader=nextReader;
        emit('searching','読み取り中… バーコード全体を枠に入れてください');tick(token);
      }catch(e){if(running&&token===serial)error(cameraError(e));}
    }
    return {start,stop,isRunning:()=>running};
  }
  return {create};
});
