// app.js — main application logic: NFC, UI, playback
// Heavily commented for clarity.
(function(){
  // Elements
  const fileInput = document.getElementById('fileInput');
  const filePickBtn = document.getElementById('filePickBtn');
  const dropZone = document.getElementById('dropZone');
  const tracksList = document.getElementById('tracksList');
  const createCardBtn = document.getElementById('createCardBtn');
  const cardNameInput = document.getElementById('cardName');
  const cardsList = document.getElementById('cardsList');
  const writeCardSelect = document.getElementById('writeCardSelect');
  const startWriteBtn = document.getElementById('startWriteBtn');
  const writeStatus = document.getElementById('writeStatus');
  const scanBtn = document.getElementById('scanBtn');
  const playBtn = document.getElementById('playBtn');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const playerTitle = document.getElementById('playerTitle');
  const playerTrack = document.getElementById('playerTrack');
  const playerCover = document.getElementById('playerCover');
  const audio = document.getElementById('audio');
  const seek = document.getElementById('seek');
  const volume = document.getElementById('volume');
  const keepPlaying = document.getElementById('keepPlaying');
  const darkToggle = document.getElementById('darkToggle');

  // App state
  let tracks = []; // list of track metadata from DB
  let cards = []; // list of cards from DB
  let activeCard = null; // currently playing card object
  let activeIndex = 0; // track index
  let isPlaying = false;
  let ndef = null; // NDEFReader instance
  let isScanning = false;
  let scanController = null;

  // Init UI
  (async function init(){
    attachUI();
    await refreshAll();
    // Try register service worker
    if('serviceWorker' in navigator){
      // Register service worker using a relative path and scope so the PWA works when hosted under
      // a repo subpath (GitHub Pages like https://user.github.io/repo/). Using './sw.js' + scope './'.
      try{ await navigator.serviceWorker.register('./sw.js', { scope: './' }); console.log('sw registered'); }
      catch(e){console.warn('sw failed',e)}
    }
    // Setup NDEFReader instance when available
    if('NDEFReader' in window){ ndef = new NDEFReader(); }
    else document.getElementById('scanBtn').disabled = true;
  async function startScan(){
    if(!ndef){ alert('Web NFC not supported in this browser. Chrome on Android required.'); return }
    if(isScanning){ alert('A scan is already active. If you see a system prompt, cancel it and try again.'); return }
    const scanBtnEl = document.getElementById('scanBtn');
    const testBtnEl = document.getElementById('testTagBtn');
    try{
      // Use AbortController if available so we can cancel scans (supported in modern Chromium)
      let options = {};
      try{
        scanController = new AbortController();
        options = { signal: scanController.signal };
      }catch(e){ scanController = null; options = {}; }

      isScanning = true; if(scanBtnEl) scanBtnEl.disabled = true; if(testBtnEl) testBtnEl.disabled = true;
      await ndef.scan(options);
      ndef.onreadingerror = () => { console.log('NFC read error'); };
      ndef.onreading = async (ev)=>{
        // Process incoming records and show debug dump
        const records = ev.message.records || [];
        const lastEl = document.getElementById('lastPayload');
        const dumpEl = document.getElementById('rawDump');
        if(records.length === 0){ if(lastEl) lastEl.textContent = 'Blank card read — no NDEF records. Use Write mode to program it.'; if(dumpEl) dumpEl.textContent = ''; return; }

        for(const r of records){
          try{
            // Build a small debug dump with metadata and raw bytes (hex)
            let meta = `type: ${r.recordType} id:${r.id||''} media:${r.mediaType||''}`;
            let hex = '';
            try{
              let buf = r.data && r.data.buffer ? r.data.buffer : (r.data instanceof ArrayBuffer ? r.data : null);
              if(!buf && typeof r.data === 'string') buf = new TextEncoder().encode(r.data).buffer;
              if(buf){ const u8 = new Uint8Array(buf); hex = Array.from(u8).map(b => b.toString(16).padStart(2,'0')).join(' '); }
            }catch(e){ hex = 'unable to extract bytes'; }
            if(dumpEl) dumpEl.textContent = `${meta}\nhex: ${hex}`;

            // Try to decode text payloads robustly
            let payloadText = '';
            if(r.recordType === 'text') payloadText = parseTextRecordPayload(r.data) || '';
            else if(r.recordType === 'url') { try{ payloadText = typeof r.data === 'string' ? r.data : new TextDecoder('utf-8').decode(r.data); }catch(e){ payloadText = String(r.data||''); } }
            else { try{ payloadText = new TextDecoder('utf-8').decode(r.data); }catch(e){ payloadText = String(r.data||''); } }

            payloadText = (payloadText||'').trim();
            if(lastEl) lastEl.textContent = `Last payload: ${payloadText}`;

            // Extract id (card://, URL param, or plain id)
            let id = null;
            if(payloadText.startsWith('card://')) id = payloadText.slice(7);
            else {
              try{ const u = new URL(payloadText); const qp = new URLSearchParams(u.search); if(qp.has('card')) id = qp.get('card'); else if(u.hash && u.hash.includes('card=')){ const hp = new URLSearchParams(u.hash.replace(/^#/,'')); if(hp.has('card')) id = hp.get('card'); } else { const parts = u.pathname.split('/').filter(Boolean); if(parts.length) id = parts[parts.length-1]; } }
              catch(e){ id = payloadText; }
            }

            if(!id || id.trim()===''){
              console.log('No usable id extracted from payload', payloadText);
              // continue scanning but show message
              continue;
            }

            // Found an id — attempt to handle it
            handleCardTap(id);

            // if this was a test scan, allow stopping after first read; otherwise keep scanning
            // We don't automatically abort regular scan to allow multi-tap reads
            break;
          }catch(e){ console.warn('read record failed',e); }
        }
      };
      if(scanBtnEl) scanBtnEl.textContent='Scanning… Tap a card';
      // Re-enable UI after a short time to avoid stuck controls if browser doesn't return
      setTimeout(()=>{ isScanning=false; if(scanBtnEl){ scanBtnEl.disabled=false; scanBtnEl.textContent='Start NFC Scan' } if(testBtnEl) testBtnEl.disabled=false; scanController = null; }, 15000);
    }catch(err){
      isScanning=false; if(scanBtnEl) { scanBtnEl.disabled=false; scanBtnEl.textContent='Start NFC Scan' } const testBtnEl2 = document.getElementById('testTagBtn'); if(testBtnEl2) testBtnEl2.disabled=false;
      alert('NFC scan failed: '+err.message);
    }
  }
  function populateWriteSelect(){
    writeCardSelect.innerHTML='';
    cards.forEach(c=>{
      const opt = document.createElement('option'); opt.value=c.id; opt.textContent=c.name; writeCardSelect.appendChild(opt);
    });
  }

  async function createCardFromInput(){
    const name = cardNameInput.value.trim()||`Card ${new Date().toLocaleString()}`;
    const rec = await DB.createCard({name,trackIds:[]});
    cardNameInput.value='';
    await refreshAll();
    alert('Card created: '+rec.name);
  }

  async function onAddTrackToCard(ev){
    const tid = ev.target.dataset.id;
    // choose card - simple prompt (could be a better UI)
    if(cards.length===0){ alert('Create a card first'); return }
    const choice = prompt('Enter card name (or blank to add to first):','');
    let card = cards[0];
    if(choice){ card = cards.find(c=>c.name===choice) || card }
    card.tracks.push(tid);
    await DB.createCard({id:card.id,name:card.name,coverDataUrl:card.cover,trackIds:card.tracks});
    await refreshAll();
    alert('Added to '+card.name);
  }

  async function startWriteFlow(){
    if(!ndef){ writeStatus.textContent='Web NFC not supported on this device/browser.'; return }
    const cardId = writeCardSelect.value;
    if(!cardId){ writeStatus.textContent='Select a card to write.'; return }
    const writeType = (document.getElementById('writeTypeSelect')||{}).value || 'text';
    writeStatus.textContent='Tap a blank card to write...';
    try{
      // Compose payloads according to selected type. Default: text record with prefix 'card://'
      const textPayload = `card://${cardId}`;
      // If URL chosen, write a URL that returns to the app with the card query param (works from Pages)
      const baseUrl = `${location.origin}${location.pathname}`;
      const appUrl = `${baseUrl}${baseUrl.includes('?')? '&':'?'}card=${encodeURIComponent(cardId)}`;
      if(writeType === 'url'){
        await ndef.write({records:[{recordType:'url',data:appUrl}]});
      }else{
        await ndef.write({records:[{recordType:'text',data:textPayload}]});
      }
      writeStatus.textContent='Write successful ✅';
      // small success animation - flash
      setTimeout(()=>writeStatus.textContent='',2000);
    }catch(err){
      // Show clearer messages for common Web NFC errors
      if(err.name === 'NotAllowedError') writeStatus.textContent = 'Write failed: permission denied (user dismissed prompt)';
      else if(err.name === 'NotSupportedError') writeStatus.textContent = 'Write failed: NFC not supported on this tag/browser';
      else writeStatus.textContent='Write failed: '+err.message;
    }
  }

  async function startScan(){
    if(!ndef){ alert('Web NFC not supported in this browser. Chrome on Android required.'); return }
    try{
      await ndef.scan();
      ndef.onreadingerror = () => console.log('NFC read error');
      ndef.onreading = async (ev)=>{
        // read NDEF message
        const records = ev.message.records || [];
        const lastEl = document.getElementById('lastPayload');
        if(records.length === 0){
          // Blank card — prompt user to write it
          if(lastEl) lastEl.textContent = 'Blank card read — no NDEF records. Use Write mode to program it.';
          console.log('Blank NDEF message');
          return;
        }

        // Helper to parse NFC Text Record per NFC Forum Text Record spec
        function parseTextRecordPayload(dataViewOrBuffer){
          // Accept ArrayBuffer, DataView or Uint8Array
          let buf;
          if(dataViewOrBuffer instanceof DataView) buf = dataViewOrBuffer.buffer;
          else if(dataViewOrBuffer instanceof ArrayBuffer) buf = dataViewOrBuffer;
          else if(dataViewOrBuffer && dataViewOrBuffer.buffer) buf = dataViewOrBuffer.buffer;
          else return null;
          const dv = new DataView(buf);
          if(dv.byteLength === 0) return '';
          const status = dv.getUint8(0);
          const isUtf16 = (status & 0x80) !== 0;
          const langLen = status & 0x3F;
          const encoding = isUtf16 ? 'utf-16' : 'utf-8';
          const textBytes = new Uint8Array(buf, 1 + langLen);
          try{ return new TextDecoder(encoding).decode(textBytes); }catch(e){ try{ return new TextDecoder('utf-8').decode(textBytes); }catch(_){ return '' } }
        }

        for(const r of records){
          try{
            let payloadText = '';
            if(r.recordType === 'text'){
              payloadText = parseTextRecordPayload(r.data) || '';
            } else if(r.recordType === 'url'){
              // Some browsers provide a string, some provide ArrayBuffer
              try{ payloadText = typeof r.data === 'string' ? r.data : new TextDecoder('utf-8').decode(r.data); }catch(e){ payloadText = String(r.data||''); }
            } else {
              // fallback: try to decode as utf-8
              try{ payloadText = new TextDecoder('utf-8').decode(r.data); }catch(e){ payloadText = String(r.data||''); }
            }

            // Trim and normalize
            payloadText = (payloadText||'').trim();
            console.log('NFC read recordType=', r.recordType, 'payload=', payloadText);
            if(lastEl) lastEl.textContent = `Last payload: ${payloadText}`;

            // Try to extract card id from possible payload formats
            // 1) card://<id>
            // 2) plain id
            // 3) URL containing ?card=<id> or #card=<id> or path ending with id
            let candidate = payloadText;
            if(!candidate) continue;
            let id = null;
            if(candidate.startsWith('card://')) id = candidate.slice(7);
            else {
              try{
                const u = new URL(candidate);
                // check query/hash params
                const qp = new URLSearchParams(u.search);
                if(qp.has('card')) id = qp.get('card');
                else if(u.hash && u.hash.includes('card=')){ const hp = new URLSearchParams(u.hash.replace(/^#/,'')); if(hp.has('card')) id = hp.get('card'); }
                else {
                  // fallback: last path segment
                  const parts = u.pathname.split('/').filter(Boolean);
                  if(parts.length) id = parts[parts.length-1];
                }
              }catch(e){
                // not a URL — treat as plain id
                id = candidate;
              }
            }

            if(!id){
              console.log('Could not extract id from payload', payloadText);
              continue;
            }

            handleCardTap(id);
            // stop after first usable record
            break;
          }catch(e){console.warn('read record failed',e)}
        }
      };
      scanBtn.textContent='Scanning… Tap a card';
    }catch(err){
      alert('NFC scan failed: '+err.message);
    }
  }

  // Start a short test scan and display last read payload in the UI
  async function startTestTag(){
    if(!ndef){ alert('Web NFC not supported in this browser. Chrome on Android required.'); return }
    if(isScanning){ alert('A scan is already active.'); return }
    const testBtn = document.getElementById('testTagBtn');
    const scanBtnEl = document.getElementById('scanBtn');
    try{
      // Use AbortController to stop after first read
      try{ scanController = new AbortController(); }catch(e){ scanController = null; }
      const options = scanController ? { signal: scanController.signal } : {};
      isScanning = true; if(testBtn) testBtn.disabled=true; if(scanBtnEl) scanBtnEl.disabled=true;
      await ndef.scan(options);
      ndef.onreadingerror = () => console.log('NFC read error');
      ndef.onreading = (ev)=>{
        const records = ev.message.records || [];
        const last = document.getElementById('lastPayload');
        const dumpEl = document.getElementById('rawDump');
        if(records.length === 0){ if(last) last.textContent = 'Blank card read — no NDEF records.'; if(dumpEl) dumpEl.textContent='';
          if(scanController) try{ scanController.abort(); }catch(_){ }
          isScanning=false; if(testBtn) testBtn.disabled=false; if(scanBtnEl) scanBtnEl.disabled=false;
          return;
        }
        for(const r of records){
          try{
            let text = '';
            try{ text = r.recordType==='text' ? parseTextRecordPayload(r.data) : (typeof r.data === 'string' ? r.data : new TextDecoder('utf-8').decode(r.data)); }
            catch(e){ text = String(r.data||''); }
            if(last) last.textContent = `Last payload: ${text}`;
            // dump
            if(dumpEl){ let buf = r.data && r.data.buffer ? r.data.buffer : (r.data instanceof ArrayBuffer? r.data : null); let hex=''; if(!buf && typeof r.data==='string') buf = new TextEncoder().encode(r.data).buffer; if(buf){ const u8=new Uint8Array(buf); hex = Array.from(u8).map(b=>b.toString(16).padStart(2,'0')).join(' ');} dumpEl.textContent = `type:${r.recordType}\nhex:${hex}` }
            // stop after first record
            if(scanController) try{ scanController.abort(); }catch(_){ }
            break;
          }catch(e){ console.warn('test read decode failed',e); }
        }
        isScanning=false; if(testBtn) testBtn.disabled=false; if(scanBtnEl) scanBtnEl.disabled=false;
      };
    }catch(err){ isScanning=false; if(testBtn) testBtn.disabled=false; if(scanBtnEl) scanBtnEl.disabled=false; alert('NFC scan failed: '+err.message); }
  }

  async function handleCardTap(text){
    // expect text to be stored card id or url like card://id
    let id = text;
    if(text.startsWith('card://')) id = text.slice(7);
    // find card
    const c = await DB.getCard(id);
    if(!c){
      alert('Card not recognized: '+id);
      return;
    }
    // If a card tapped, start playback immediately, stopping any existing
    startCardPlayback(c);
  }

  async function startCardPlayback(card){
    activeCard = card;
    activeIndex = 0;
    updatePlayerMeta();
    await loadAndPlayIndex(activeIndex);
  }

  async function loadAndPlayIndex(idx){
    if(!activeCard) return;
    const tid = activeCard.tracks[idx];
    if(!tid){ console.log('no track at index',idx); stopPlayback(); return }
    const t = await DB.getTrack(tid);
    if(!t){ console.warn('track missing',tid); return }
    const url = URL.createObjectURL(t.blob);
    audio.src = url;
    audio.volume = Math.min(0.7, parseFloat(volume.value)); // safe cap ~70%
    try{ await audio.play(); isPlaying=true; playBtn.textContent='⏸'; }
    catch(e){console.warn('autoplay prevented',e); isPlaying=false; playBtn.textContent='▶️';}
    updatePlayerMeta();
  }

  function updatePlayerMeta(){
    if(!activeCard){ playerTitle.textContent='No card tapped'; playerTrack.textContent='—'; playerCover.src=''; return }
    playerTitle.textContent = activeCard.name;
    playerTrack.textContent = (activeCard.tracks[activeIndex]||'') ? `Track ${activeIndex+1} of ${activeCard.tracks.length}` : '—';
    if(activeCard.cover) playerCover.src = activeCard.cover; else playerCover.src='';
  }

  function onTrackEnded(){
    if(activeCard && activeIndex < activeCard.tracks.length-1){ activeIndex++; loadAndPlayIndex(activeIndex); }
    else{ stopPlayback(); }
  }

  function stopPlayback(){ audio.pause(); isPlaying=false; playBtn.textContent='▶️'; }

  function togglePlay(){ if(isPlaying){ audio.pause(); isPlaying=false; playBtn.textContent='▶️'; } else { audio.play(); isPlaying=true; playBtn.textContent='⏸'; } }
  function playPrev(){ if(!activeCard) return; activeIndex = Math.max(0,activeIndex-1); loadAndPlayIndex(activeIndex); }
  function playNext(){ if(!activeCard) return; activeIndex = Math.min(activeCard.tracks.length-1, activeIndex+1); loadAndPlayIndex(activeIndex); }

  function updateSeek(){ if(!audio.duration || isNaN(audio.duration)) return; seek.max = Math.floor(audio.duration); seek.value = Math.floor(audio.currentTime); }
  function onSeek(e){ audio.currentTime = e.target.value; }
  function onVolumeChange(e){ audio.volume = Math.min(0.7, parseFloat(e.target.value)); }

  function toggleDark(){ document.body.classList.toggle('light'); }

  // small edit card UI (rudimentary)
  async function editCard(id){
    const c = await DB.getCard(id);
    if(!c) return;
    const newName = prompt('Card name', c.name);
    if(newName===null) return;
    c.name = newName;
    await DB.createCard({id:c.id,name:c.name,coverDataUrl:c.cover,trackIds:c.tracks});
    await refreshAll();
  }

  // Utility
  function escapeHtml(s){ return s.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch])) }

})();
