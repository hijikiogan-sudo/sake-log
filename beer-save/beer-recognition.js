(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BeerRecognition=factory();})(typeof window!=='undefined'?window:this,function(){
  'use strict';
  const unique=values=>[...new Set(values)];
  const normalize=value=>String(value??'').normalize('NFKC').toUpperCase().replace(/[\s\p{P}\p{S}]/gu,'');
  function jan(value){
    let code=String(value??'').normalize('NFKC').replace(/[\s-]/g,'');
    if(code==='')return '';
    if(/^\d{12}$/.test(code))code='0'+code;
    if(!/^(\d{8}|\d{13})$/.test(code)||/^0+$/.test(code))return null;
    const digits=[...code].map(Number),check=digits.pop();let sum=0;
    for(let i=digits.length-1,weight=3;i>=0;i--,weight=weight===3?1:3)sum+=digits[i]*weight;
    return (10-sum%10)%10===check?code:null;
  }
  function facts(raw){
    const text=String(raw??'').normalize('NFKC').replace(/\r/g,'').replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\t ]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu,'$1').replace(/(\d),(\d)/g,'$1.$2');
    const volumes=[],alcohols=[],calorieValues=[],warnings=[];
    for(const match of text.matchAll(/(\d{2,4}(?:\.\d+)?)\s*(?:ml|mℓ|ミリリットル)/gi)){
      const n=Number(match[1]),after=text.slice(match.index+match[0].length,match.index+match[0].length+15),before=text.slice(Math.max(0,match.index-12),match.index);
      if(n===100&&(/当[たた]?り|あたり|あたリ|につき/i.test(after)||/per\s*$/i.test(before)))continue;
      if(n>0&&n<=10000)volumes.push(n);
    }
    for(const match of text.matchAll(/(?:ALC(?:OHOL)?\.?|アルコール(?:分)?|度数)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/gi))alcohols.push(Number(match[1]));
    if(!alcohols.length){
      for(const line of text.split('\n')){
        if(/糖|果汁|果実|プリン|OFF|オフ|カット|減|脂質|炭水化物/i.test(line))continue;
        for(const match of line.matchAll(/(\d+(?:\.\d+)?)\s*%/g))alcohols.push(Number(match[1]));
      }
    }
    for(const match of text.matchAll(/(\d+(?:\.\d+)?)\s*k\s*cal/gi))calorieValues.push(Number(match[1]));
    const v=unique(volumes),a=unique(alcohols.filter(n=>n>=0&&n<=100)),c=unique(calorieValues);
    const per100=/(?:100\s*(?:ml|mℓ)\s*(?:当[たた]?り|あたり|あたリ|につき)|per\s*100\s*ml)/i.test(text);
    const perCan=/(?:1\s*(?:缶|本)(?:\s*[（(][^\n）)]*[）)])?\s*(?:当[たた]?り|あたり|あたリ|につき)|per\s*can)/i.test(text);
    const basis=per100&&!perCan?'100ml':perCan&&!per100?'can':null;
    if(v.length>1)warnings.push('容量の数値が複数あります');
    if(a.length>1)warnings.push('度数の数値が複数あります');
    if(a.includes(0))warnings.push('0.0%の表示があります。対象商品を確認してください');
    if(c.length&&!basis)warnings.push('カロリーの基準量が確認できません');
    const nameLines=unique(text.split('\n').map(s=>s.trim()).filter(s=>s.length>=2&&s.length<=100&&/\p{L}/u.test(s)&&!/(?:kcal|エネルギー|栄養|容量|アルコール|ALC\.?|糖質|炭水化物|たんぱく|食塩|賞味|製造|内容量|100\s*ml|\d\s*%|\d\s*ml)/i.test(s))).slice(0,6);
    return {text,volumes:v,alcohols:a,volumeMl:v.length===1?v[0]:null,alcoholPercent:a.length===1?a[0]:null,calorieValue:c.length===1?c[0]:null,calorieBasis:basis,nameLines,warnings};
  }
  function calories(info,volume){
    if(info.calorieValue===null||!info.calorieBasis)return null;
    if(info.calorieBasis==='can')return info.calorieValue;
    return Number.isFinite(volume)&&volume>0?Number((info.calorieValue*volume/100).toFixed(4)):null;
  }
  function pool(products,catalog){
    const all=products.map(p=>({...p})),savedByJan=new Map();
    for(const p of all){const code=jan(p.janCode);if(code){if(!savedByJan.has(code))savedByJan.set(code,[]);savedByJan.get(code).push(p);}}
    for(const p of catalog){
      // A saved copy of the same catalog entry is one candidate. Conflicting user entries remain distinct.
      const saved=(savedByJan.get(jan(p.janCode))||[]).find(q=>q.productName===p.productName&&q.volumeMl===p.volumeMl&&q.alcoholPercent===p.alcoholPercent&&q.revision===p.revision&&q.caloriesKcal===p.caloriesKcal&&q.category===p.category);
      if(saved)Object.assign(saved,{aliases:p.aliases,excludeTokens:p.excludeTokens,ocrAliases:p.ocrAliases,catalog:true,requiresConfirmation:!!p.requiresConfirmation});else all.push(p);
    }
    return all;
  }
  function plan(raw,barcode,products,catalog=[]){
    const info=facts(raw),code=jan(barcode),text=normalize(info.text),all=pool(products,catalog);let candidates=[],reason='unknown';
    if(code){candidates=all.filter(p=>jan(p.janCode)===code);reason=candidates.length?'barcode':'unknown-barcode';}
    if(!candidates.length&&reason!=='unknown-barcode'){
      candidates=all.filter(p=>{
        const name=normalize(p.productName),flavor=normalize(p.flavor);
        const aliases=p.aliases||[p.productName];
        const corrected=p.catalog&&(p.ocrAliases||[]).some(x=>text.includes(normalize(x)))&&['SUNTORY','サントリー'].some(x=>text.includes(x));
        const matched=p.catalog?(aliases.some(x=>text.includes(normalize(x)))||corrected):name.length>=2&&!['ビール','チューハイ','サワー','ハイボール','BEER','HIGHBALL'].includes(name)&&text.includes(name)&&(!flavor||text.includes(flavor));
        return matched&&!(p.excludeTokens||[]).some(x=>text.includes(normalize(x)))&&(!info.volumes.length||info.volumes.includes(p.volumeMl))&&(!info.alcohols.length||info.alcohols.includes(p.alcoholPercent));
      });reason=candidates.length?'ocr':'unknown';
    }
    const conflict=candidates.length===1&&(candidates[0].requiresConfirmation||info.volumes.some(v=>v!==candidates[0].volumeMl)||info.alcohols.some(a=>a!==candidates[0].alcoholPercent));
    const autoSave=reason==='barcode'&&candidates.length===1&&!conflict;
    return {info,janCode:code||'',candidates,reason,conflict,autoSave,reviewReason:candidates.some(p=>p.requiresConfirmation)?'公式情報に容量・度数の変更が見つかりました。缶の表示を確認してください。':''};
  }
  return {normalize,jan,facts,calories,plan};
});
