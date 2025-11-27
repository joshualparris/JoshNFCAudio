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
  })();

  function attachUI(){
    filePickBtn.addEventListener('click',()=>fileInput.click());
    fileInput.addEventListener('change',handleFiles);
    ['dragenter','dragover'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('drag')}));
    ['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('drag')}));
    dropZone.addEventListener('drop',e=>{handleFiles({target:{files:e.dataTransfer.files}})});
    createCardBtn.addEventListener('click',createCardFromInput);
    startWriteBtn.addEventListener('click',startWriteFlow);
    scanBtn.addEventListener('click',startScan);
    document.getElementById('testTagBtn').addEventListener('click',startTestTag);
    playBtn.addEventListener('click',togglePlay);
    prevBtn.addEventListener('click',playPrev);
    nextBtn.addEventListener('click',playNext);
    audio.addEventListener('ended',onTrackEnded);
    audio.addEventListener('timeupdate',updateSeek);
    seek.addEventListener('input',onSeek);
    volume.addEventListener('input',onVolumeChange);
    darkToggle.addEventListener('click',toggleDark);
  }

  async function refreshAll(){
    tracks = await DB.listTracks();
    cards = await DB.listCards();
    renderTracks();
    renderCards();
    populateWriteSelect();
  }

  // Handle file uploads
  async function handleFiles(e){
    const files = e.target.files;
    for(const f of files){
      // accept audio files only
      if(!f.type.startsWith('audio')) continue;
      await DB.addTrack(f);
    }
    await refreshAll();
  }

  function renderTracks(){
    tracksList.innerHTML = '';
    if(tracks.length===0){ tracksList.textContent='No tracks uploaded yet.'; return }
    tracks.forEach(t=>{
      const el = document.createElement('div'); el.className='card';
      el.innerHTML = `<div><strong>${escapeHtml(t.name)}</strong></div>
        <div class="small">${Math.round(t.size/1024)} KB</div>
        <div class="row"><button data-id="${t.id}" class="btn addTrack">Add to Card</button>
        <button data-id="${t.id}" class="btn small delTrack">Delete</button></div>`;
      tracksList.appendChild(el);
    });
    // attach add/delete handlers
    tracksList.querySelectorAll('.addTrack').forEach(b=>b.addEventListener('click',onAddTrackToCard));
    tracksList.querySelectorAll('.delTrack').forEach(b=>b.addEventListener('click',async ev=>{await DB.deleteTrack(ev.target.dataset.id);await refreshAll()}));
  }

  function renderCards(){
    cardsList.innerHTML='';
    if(cards.length===0){cardsList.textContent='No cards yet.';return}
    cards.forEach(c=>{
      const el = document.createElement('div'); el.className='card';
      el.innerHTML = `<div style="display:flex;justify-content:space-between"><strong>${escapeHtml(c.name)}</strong>
        <div><button data-id="${c.id}" class="btn small playCard">▶</button>
        <button data-id="${c.id}" class="btn small editCard">✏️</button>
        <button data-id="${c.id}" class="btn small delCard">🗑</button></div></div>
        <div class="small">${c.tracks.length} tracks</div>`;
      cardsList.appendChild(el);
    });
    // handlers
    cardsList.querySelectorAll('.playCard').forEach(b=>b.addEventListener('click',async ev=>{const cid=ev.target.dataset.id;const c=await DB.getCard(cid);startCardPlayback(c);}));
    cardsList.querySelectorAll('.delCard').forEach(b=>b.addEventListener('click',async ev=>{if(confirm('Delete card?')){await DB.deleteCard(ev.target.dataset.id);await refreshAll();}}));
    cardsList.querySelectorAll('.editCard').forEach(b=>b.addEventListener('click',ev=>editCard(ev.target.dataset.id)));
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
        if(records.length === 0){
          // Blank card — prompt user to write it
          const last = document.getElementById('lastPayload'); if(last) last.textContent = 'Blank card read — no NDEF records. Use Write mode to program it.';
          console.log('Blank NDEF message');
          return;
        }
        for(const r of records){
          try{
            let text='';
            // r.data may be a DataView or string depending on browser; try to decode carefully
            if(r.recordType==='text'){
              if(r.encoding){ // some browsers expose encoding
                const decoder = new TextDecoder(r.encoding||'utf-8');
                text = decoder.decode(r.data);
              } else {
                // attempt to treat r.data as a DOMString or Uint8Array
                try{ text = new TextDecoder('utf-8').decode(r.data); }catch(_){ text = String(r.data || ''); }
              }
            }else if(r.recordType==='url'){
              try{ text = new TextDecoder('utf-8').decode(r.data); }catch(_){ text = String(r.data || ''); }
            } else {
              try{ text = new TextDecoder('utf-8').decode(r.data); }catch(_){ text = String(r.data || ''); }
            }
            console.log('NFC read',text);
            const last = document.getElementById('lastPayload'); if(last) last.textContent = `Last payload: ${text}`;
            handleCardTap(text);
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
    try{
      await ndef.scan();
      ndef.onreadingerror = () => console.log('NFC read error');
      ndef.onreading = (ev)=>{
        const records = ev.message.records || [];
        const last = document.getElementById('lastPayload');
        if(records.length === 0){ if(last) last.textContent = 'Blank card read — no NDEF records.'; return; }
        for(const r of records){
          try{ const text = new TextDecoder('utf-8').decode(r.data); if(last) last.textContent = `Last payload: ${text}`; console.log('test read',text); }
          catch(e){ console.warn('test read decode failed',e); }
        }
      };
    }catch(err){ alert('NFC scan failed: '+err.message); }
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
