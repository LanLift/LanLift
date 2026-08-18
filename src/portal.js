'use strict';

function portalHtml(token) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1220">
<title>LanLift 傳輸</title>
<style>
  :root { color-scheme: dark; --bg:#0b1220; --panel:#141e30; --line:#26354d; --ink:#edf4ff; --muted:#9dafc7; --accent:#4fd1c5; --accent2:#62a7ff; --danger:#ff7b8e; }
  * { box-sizing: border-box; } body { margin:0; min-height:100vh; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--ink); background:radial-gradient(1000px 600px at 15% -10%,#223b71 0%,transparent 52%),var(--bg); }
  main { max-width:680px; margin:0 auto; padding:calc(28px + env(safe-area-inset-top)) 18px calc(32px + env(safe-area-inset-bottom)); }
  header { display:flex; align-items:center; gap:12px; margin:0 0 28px; } .mark { width:39px; height:39px; display:grid; place-items:center; border-radius:13px; color:#05242b; background:linear-gradient(135deg,var(--accent),#99f6e4); font-weight:900; font-size:19px; box-shadow:0 9px 28px #48d1c54a; } h1 { font-size:20px; margin:0; letter-spacing:-.3px; } .subtitle { margin:4px 0 0; font-size:13px; color:var(--muted); }
  .card { background:#121d2eea; border:1px solid var(--line); border-radius:20px; padding:22px; box-shadow:0 20px 60px #00000030; } h2 { font-size:20px; margin:0 0 9px; letter-spacing:-.3px; } p { color:var(--muted); line-height:1.55; margin:0 0 16px; } label { display:block; color:#c7d4e7; font-size:13px; font-weight:600; margin:17px 0 7px; } input[type="text"] { width:100%; border:1px solid #31425c; background:#0b1422; border-radius:12px; color:var(--ink); padding:13px; font-size:16px; outline:none; } input:focus { border-color:var(--accent2); box-shadow:0 0 0 3px #62a7ff25; }
  button, .file-label { width:100%; border:0; cursor:pointer; border-radius:12px; font:inherit; font-weight:750; padding:13px 16px; margin-top:16px; text-align:center; background:linear-gradient(135deg,var(--accent),#78e7df); color:#05242b; } button:disabled { cursor:not-allowed; opacity:.56; } .file-label { display:block; background:#1d2e47; color:#dbeafe; border:1px solid #395273; } .file-label input { display:none; }
  .pill { display:inline-flex; align-items:center; gap:6px; padding:6px 9px; border-radius:999px; background:#1d2c42; border:1px solid #30445f; color:#b9c9e0; font-size:12px; margin:0 0 15px; } .dot { width:7px; height:7px; border-radius:50%; background:#f8c05c; box-shadow:0 0 10px #f8c05c; }
  .hidden { display:none !important; } .files { display:grid; gap:10px; margin:14px 0; } .file { display:flex; align-items:center; justify-content:space-between; gap:12px; background:#0d1726; border:1px solid #263953; border-radius:13px; padding:12px 13px; } .file-name { min-width:0; font-size:14px; font-weight:650; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; } .file-size { display:block; font-size:12px; font-weight:400; color:var(--muted); margin-top:3px; } a.download { flex:0 0 auto; color:#091724; text-decoration:none; background:#b7e9ff; padding:8px 10px; border-radius:9px; font-size:12px; font-weight:800; }
  .progress-wrap { margin-top:15px; } .progress-copy { display:flex; justify-content:space-between; color:#b7c7dd; font-size:12px; margin-bottom:7px; } .bar { height:7px; border-radius:99px; background:#263750; overflow:hidden; } .bar > i { display:block; height:100%; width:0%; background:linear-gradient(90deg,var(--accent),var(--accent2)); transition:width .18s; } .error { color:#ffc0c9; background:#3d1f2a; border:1px solid #704052; border-radius:12px; padding:11px 13px; font-size:13px; margin-top:14px; }
  .foot { text-align:center; font-size:12px; color:#70839e; margin:21px 4px 0; line-height:1.5; } .status { text-align:center; padding:22px 0 4px; } .spinner { width:32px; height:32px; border:3px solid #294160; border-top-color:var(--accent); border-radius:50%; margin:0 auto 16px; animation:spin 1s linear infinite; } @keyframes spin { to { transform:rotate(360deg); } }
</style>
</head>
<body>
<main>
<header><div class="mark">L</div><div><h1>LanLift</h1><p class="subtitle">私人區域網路傳輸</p></div></header>
<section id="join" class="card">
  <h2>連接到這台 Windows 電腦</h2>
  <p>請輸入裝置名稱。Windows 端核准後，即可在此頁直接收發檔案。</p>
  <label for="name">你的裝置名稱</label><input id="name" type="text" maxlength="48" autocomplete="name" placeholder="例如：小明的 iPhone">
  <button id="joinBtn">送出連線請求</button><div id="joinError" class="error hidden"></div>
</section>
<section id="waiting" class="card hidden"><div class="status"><div class="spinner"></div><h2>等待 Windows 核准</h2><p>請在 LanLift 視窗中允許此裝置。此頁會自動更新。</p></div></section>
<section id="transfer" class="hidden">
  <div class="card">
    <div class="pill"><span class="dot"></span><span id="expires">已建立安全連線</span></div>
    <h2>從電腦接收</h2><p>點選下載，即可將檔案儲存到此裝置。</p>
    <div id="downloads" class="files"><p>Windows 尚未加入任何檔案。</p></div>
  </div>
  <div class="card" style="margin-top:14px">
    <h2>傳送到電腦</h2><p>所選檔案會直接經由目前 Wi-Fi 傳輸至 Windows 的 LanLift 資料夾。</p>
    <label class="file-label">選取要上傳的檔案<input id="picker" type="file" multiple></label>
    <div id="uploadProgress" class="progress-wrap hidden"><div class="progress-copy"><span id="uploadName">準備上傳</span><span id="uploadPct">0%</span></div><div class="bar"><i id="uploadBar"></i></div></div>
    <div id="uploadError" class="error hidden"></div>
  </div>
</section>
<p class="foot">此連線只在同一個 Wi-Fi 網路有效，並會在短時間後自動失效。檔案不會上傳到雲端。</p>
</main>
<script>
(() => {
  const token = ${JSON.stringify(token)};
  const api = '/api/s/' + token;
  let clientId = sessionStorage.getItem('lanlift-client-' + token) || '';
  const $ = id => document.getElementById(id);
  const bytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1)+' KB' : n < 1073741824 ? (n/1048576).toFixed(1)+' MB' : (n/1073741824).toFixed(2)+' GB';
  const message = (id, text) => { const e=$(id); e.textContent=text; e.classList.toggle('hidden', !text); };
  const setScreen = name => ['join','waiting','transfer'].forEach(x => $(x).classList.toggle('hidden', x !== name));
  const makeId = () => crypto.getRandomValues(new Uint8Array(16)).reduce((s,v)=>s+v.toString(16).padStart(2,'0'),'');
  async function pair() {
    const name = $('name').value.trim() || 'Apple 裝置';
    $('joinBtn').disabled=true; message('joinError','');
    try {
      if (!clientId) clientId = makeId();
      const r = await fetch(api+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:clientId,name})});
      const data=await r.json(); if(!r.ok) throw new Error(data.error || '無法建立連線。');
      clientId=data.id; sessionStorage.setItem('lanlift-client-'+token,clientId); setScreen(data.state==='approved'?'transfer':'waiting'); poll();
    } catch(e) { message('joinError',e.message); } finally { $('joinBtn').disabled=false; }
  }
  function render(data) {
    const seconds=Math.max(0,Math.ceil((data.expiresAt-Date.now())/1000)); $('expires').textContent='連線有效期剩餘 ' + Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
    const list=$('downloads'); list.replaceChildren();
    if (!data.files || !data.files.length) { const p=document.createElement('p'); p.textContent='Windows 尚未加入任何檔案。'; list.append(p); return; }
    data.files.forEach(file => { const row=document.createElement('div'); row.className='file'; const info=document.createElement('div'); info.style.minWidth='0'; const n=document.createElement('div'); n.className='file-name'; n.textContent=file.name; const z=document.createElement('span'); z.className='file-size'; z.textContent=bytes(file.size); info.append(n,z); const link=document.createElement('a'); link.className='download'; link.textContent='下載'; link.href=api+'/download/'+encodeURIComponent(file.id)+'?client='+encodeURIComponent(clientId); row.append(info,link); list.append(row); });
  }
  async function poll() {
    if (!clientId) return;
    try { const r=await fetch(api+'/info?client='+encodeURIComponent(clientId),{cache:'no-store'}); const d=await r.json(); if(!r.ok) throw new Error(d.error||'連線失敗'); if(d.state==='approved'){setScreen('transfer');render(d);} else if(d.state==='rejected'){setScreen('join');message('joinError','Windows 端拒絕了此連線。');return;} else {setScreen('waiting');} } catch(e) { setScreen('join'); message('joinError',e.message); return; }
    setTimeout(poll, 1800);
  }
  function upload(files) {
    if(!files.length) return; message('uploadError',''); $('uploadProgress').classList.remove('hidden'); const data=new FormData(); [...files].forEach(f=>data.append('files',f)); $('uploadName').textContent='正在傳送 '+files.length+' 個檔案'; $('uploadPct').textContent='0%'; $('uploadBar').style.width='0%';
    const x=new XMLHttpRequest(); x.open('POST',api+'/upload?client='+encodeURIComponent(clientId)); x.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded/e.total*100);$('uploadPct').textContent=p+'%';$('uploadBar').style.width=p+'%';}}; x.onload=()=>{let d={};try{d=JSON.parse(x.responseText)}catch{} if(x.status>=200&&x.status<300){$('uploadPct').textContent='完成';$('uploadBar').style.width='100%';$('picker').value='';}else message('uploadError',d.error||'上傳失敗。');}; x.onerror=()=>message('uploadError','網路中斷，請重新嘗試。'); x.send(data);
  }
  $('joinBtn').addEventListener('click',pair); $('name').addEventListener('keydown',e=>{if(e.key==='Enter')pair();}); $('picker').addEventListener('change',e=>upload(e.target.files));
  if(clientId) poll();
})();
</script>
</body></html>`;
}

module.exports = { portalHtml };
