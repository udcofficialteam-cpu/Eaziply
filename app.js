/* Eaziply: browser-side PDF tools. No upload API, backend, account or paid API key. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; }
  const state = {
    tool: null, files: [], previewDoc: null, previewFile: null, pdfPage: 1, pageCount: 0, viewScale: 1, previewPageWidth: 600,
    position: { x: 0.43, y: 0.62 }, positionSet: false, signatureImageFile: null,
    signatureDrawn: false, signaturePadReady: false, busy: false, selectedSavedSignatureId: '',
    continuousView: false, pageObserver: null, pageRenderJobs: new Map(),
    pageItems: [], selectedItemId: null, itemCounter: 0, savedSignatures: [], editorMode: 'signature',
    acroFields: [], acroValues: {}, previewGeneration: 0
  };
  const TOOL = {
    merge: { title:'Merge PDF', description:'Combine two or more PDFs into one document, in the order you select them.', accept:'.pdf,application/pdf', multiple:true, category:'organize' },
    split: { title:'Split PDF', description:'Create one PDF per selected page and download the pages together as a ZIP.', accept:'.pdf,application/pdf', category:'organize' },
    extract: { title:'Extract pages', description:'Copy selected pages into one new PDF, leaving the original unchanged.', accept:'.pdf,application/pdf', category:'organize' },
    delete: { title:'Delete pages', description:'Remove page numbers you choose and download the remaining document.', accept:'.pdf,application/pdf', category:'organize' },
    rotate: { title:'Rotate PDF', description:'Rotate all pages or only the page numbers you choose.', accept:'.pdf,application/pdf', category:'organize' },
    'images-to-pdf': { title:'JPG / images to PDF', description:'Turn selected images into a single PDF document.', accept:'image/*', multiple:true, category:'convert' },
    'pdf-to-images': { title:'PDF to JPG / PNG', description:'Render selected PDF pages as images and download them in a ZIP.', accept:'.pdf,application/pdf', category:'convert' },
    sign: { title:'Fill & Sign PDF', description:'Fill interactive form fields, add text, and create, save and place reusable signatures across every page.', accept:'.pdf,application/pdf', category:'sign' },
    'add-text': { title:'Fill & Sign PDF', description:'Add and format text anywhere in your PDF. You can also sign and fill form fields in this same editor.', accept:'.pdf,application/pdf', category:'sign' },
    watermark: { title:'Watermark PDF', description:'Add a text watermark to every page or a selected page range.', accept:'.pdf,application/pdf', category:'sign' },
    'page-numbers': { title:'Add page numbers', description:'Add page numbers to your PDF in one action.', accept:'.pdf,application/pdf', category:'sign' },
    compress: { title:'Optimize PDF (basic)', description:'Re-save a PDF using object streams. This basic option may not reduce every file.', accept:'.pdf,application/pdf', category:'optimize' }
  };
  let toastTimer;
  function toast(message) { const el=$('toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),3500); }
  function setStatus(message, kind='') { const box=$('statusBox'); box.className='status-box'+(kind?' is-'+kind:''); $('statusText').textContent=message; }
  function humanBytes(bytes) { if (!Number.isFinite(bytes)) return '—'; if (bytes < 1024) return `${bytes} B`; if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`; return `${(bytes/1048576).toFixed(2)} MB`; }
  function stem(name='document') { return name.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'') || 'document'; }
  function isPdf(file) { return file && (file.type==='application/pdf' || /\.pdf$/i.test(file.name)); }
  function downloadBlob(blob, filename) { const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),15000); }
  function downloadBytes(bytes, filename, mime='application/pdf') { downloadBlob(new Blob([bytes], {type:mime}), filename); }
  function parsePageRanges(raw, total) {
    const value=(raw||'all').trim().toLowerCase();
    if (!value || value==='all') return Array.from({length:total},(_,i)=>i+1);
    const selected=new Set();
    for (const part of value.split(',')) {
      const p=part.trim(); if (!p) continue;
      if (/^\d+$/.test(p)) { const n=Number(p); if (n<1||n>total) throw new Error(`Page ${n} does not exist. This PDF has ${total} page(s).`); selected.add(n); continue; }
      const m=p.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) throw new Error('Enter page numbers like 1, 3-5, 8 or all.');
      let a=Number(m[1]), b=Number(m[2]); if (a>b) [a,b]=[b,a];
      if (a<1 || b>total) throw new Error(`Page range ${part} is outside this PDF. It has ${total} page(s).`);
      for(let n=a;n<=b;n++) selected.add(n);
    }
    if (!selected.size) throw new Error('Enter at least one valid page number or use “all”.');
    return [...selected].sort((a,b)=>a-b);
  }
  async function loadPdfLib(file) { if (!window.PDFLib) throw new Error('PDF library did not load. Check your internet connection, then refresh the page.'); return PDFLib.PDFDocument.load(await file.arrayBuffer()); }
  async function loadPdfJs(file) { if (!window.pdfjsLib) throw new Error('PDF preview library did not load. Check your internet connection, then refresh the page.'); const bytes=new Uint8Array(await file.arrayBuffer()); return pdfjsLib.getDocument({data:bytes}).promise; }
  function optionsHtml(tool) {
    switch(tool) {
      case 'merge': return `<div class="note-box">Select at least two PDFs. Files will be combined in the order shown above; use the file chooser selection order.</div>`;
      case 'split': return `<div class="option-field"><label for="pageRange">Pages to split (optional)</label><input id="pageRange" value="all" placeholder="e.g. 1-3, 5 or all"><span class="option-hint">Each selected page becomes a separate PDF inside one ZIP.</span></div>`;
      case 'extract': return `<div class="option-field"><label for="pageRange">Pages to keep</label><input id="pageRange" value="all" placeholder="e.g. 1, 3-5, 8 or all"><span class="option-hint">Selected pages are saved together in a new PDF.</span></div>`;
      case 'delete': return `<div class="option-field"><label for="pageRange">Page numbers to delete</label><input id="pageRange" placeholder="e.g. 2, 4-6"><span class="option-hint">The original file is not changed. At least one page must remain.</span></div>`;
      case 'rotate': return `<div class="option-field"><label for="pageRange">Pages to rotate</label><input id="pageRange" value="all" placeholder="all or 1, 3-5"><span class="option-hint">Leave as “all” to rotate every page.</span></div><div class="option-field"><label for="rotateDegrees">Rotation</label><select id="rotateDegrees"><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select></div>`;
      case 'images-to-pdf': return `<div class="option-field"><label for="imagePageSize">PDF page size</label><select id="imagePageSize"><option value="fit">Fit page to each image</option><option value="a4">A4 page (fit image inside)</option><option value="letter">US Letter page (fit image inside)</option></select><span class="option-hint">Images are arranged in the order selected.</span></div><div class="note-box">For best output, upload JPG or PNG files. Other image formats are converted through your browser when supported.</div>`;
      case 'pdf-to-images': return `<div class="option-field"><label for="pageRange">Pages to export</label><input id="pageRange" value="all" placeholder="all or 1, 3-5"><span class="option-hint">Large PDFs may use a lot of device memory. A maximum of 40 pages per export is allowed.</span></div><div class="option-row"><div class="option-field"><label for="imageFormat">Image format</label><select id="imageFormat"><option value="image/jpeg">JPG (smaller)</option><option value="image/png">PNG (crisper)</option></select></div><div class="option-field"><label for="renderScale">Image quality / scale</label><select id="renderScale"><option value="1">Standard</option><option value="1.5" selected>High</option><option value="2">Very high</option></select></div></div>`;
      case 'sign': return `<div class="fill-sign-sidebar">
        <section id="signatureEditorPanel" class="editor-settings-panel">
          <div class="option-field"><label for="signatureMode">Create or choose signature</label><select id="signatureMode"><option value="typed">Type a name</option><option value="draw">Draw with mouse or touch</option><option value="upload">Upload signature image</option><option value="saved">Use a saved signature</option></select></div>
          <div id="typedSignatureFields">
            <div class="option-field"><label for="signatureName">Your name</label><input id="signatureName" value="" maxlength="90" placeholder="Type your name"></div>
            <div class="option-field"><label for="signatureStyle">Handwriting style</label><select id="signatureStyle">
              <option value="greatvibes">Great Vibes — elegant</option><option value="allura">Allura — classic</option><option value="dancing">Dancing Script — natural</option><option value="satisfy">Satisfy — flowing</option><option value="pacifico">Pacifico — bold</option><option value="caveat">Caveat — casual</option><option value="parisienne">Parisienne — formal</option><option value="cookie">Cookie — handwritten</option><option value="kaushan">Kaushan Script — brush</option><option value="marck">Marck Script — simple</option><option value="playball">Playball — smooth</option><option value="sacramento">Sacramento — light</option>
            </select></div>
            <div class="option-field"><label for="signatureColor">Ink colour</label><input id="signatureColor" type="color" value="#17213f"></div>
            <div class="signature-preview-card"><span>Preview</span><canvas id="signaturePreviewCanvas" width="760" height="150" aria-label="Signature preview"></canvas></div>
          </div>
          <div id="drawSignatureFields" hidden><div class="option-field"><label>Draw your signature</label><div class="signature-pad-wrap"><canvas class="signature-pad" id="signaturePad" width="760" height="190" aria-label="Draw signature here"></canvas><div class="pad-actions"><button class="small-button" id="clearSignaturePad" type="button">Clear drawing</button></div></div><span class="option-hint">Use your mouse, trackpad or finger on a touchscreen.</span></div></div>
          <div id="uploadSignatureFields" hidden><div class="option-field"><label for="signatureUpload">Signature image (PNG preferred)</label><input id="signatureUpload" type="file" accept="image/png,image/jpeg,image/webp"><span class="option-hint">A transparent PNG gives the cleanest result.</span></div></div>
          <div id="savedSignatureFields" hidden><div class="option-field"><label for="savedSignatureSelect">Saved signatures on this device</label><select id="savedSignatureSelect"><option value="">No saved signatures yet</option></select></div><button class="small-button" id="deleteSavedSignatureButton" type="button">Delete selected signature</button></div>
          <div class="signature-save-row"><button class="small-button" id="saveSignatureButton" type="button">＋ Save this signature</button><span id="savedSignatureStatus" class="option-hint">Saved privately in this browser on this device.</span></div>
          <div class="option-field"><label for="signatureWidth">Signature width</label><div class="range-value-row"><input id="signatureWidth" type="range" min="70" max="320" value="150"><output id="signatureWidthValue">150 pt</output></div></div>
          <div class="note-box">Choose Sign in the top toolbar, then click any page to place this signature. Drag the signature to move it or use a corner handle to resize it.</div>
        </section>
        <section id="textEditorPanel" class="editor-settings-panel" hidden>
          <div class="option-field"><label for="textToAdd">Text to add</label><textarea id="textToAdd" maxlength="1500" rows="4" placeholder="Type or paste your text here, then click a PDF page. You can also edit text directly in the page box."></textarea></div>
          <div class="option-row"><div class="option-field"><label for="textFontSize">Font size</label><input id="textFontSize" type="number" min="6" max="72" value="12"></div><div class="option-field"><label for="textColor">Text colour</label><input id="textColor" type="color" value="#111827"></div></div>
          <div class="option-row"><div class="option-field"><label for="textFontFamily">Font</label><select id="textFontFamily"><option value="helvetica">Arial / Helvetica</option><option value="times">Times New Roman</option><option value="courier">Courier</option></select></div><div class="option-field"><label for="textAlign">Alignment</label><select id="textAlign"><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></div></div>
          <div class="text-style-toggles"><label><input id="textBold" type="checkbox"> <strong>B</strong> Bold</label><label><input id="textItalic" type="checkbox"> <em>I</em> Italic</label></div>
          <label class="check-field cover-text-option"><input id="coverExistingText" type="checkbox"><span>Cover old text before adding replacement (best on plain backgrounds)</span></label>
          <div class="note-box">Select Text in the top toolbar and click anywhere on a page. Type directly into the box, then drag it to adjust its position. This adds new text; it does not rewrite every original PDF text object.</div>
        </section>
        <section id="formEditorPanel" class="editor-settings-panel" hidden>
          <div class="form-fields-intro"><strong>Interactive PDF fields</strong><p>When your PDF contains fillable fields, click them on the page or use the list below. Your entries will be included in the downloaded PDF.</p></div>
          <div id="acroFormFields" class="acro-form-fields"><p class="option-hint">Upload a PDF to check for fillable fields.</p></div>
          <div class="note-box">If the document is a flat scan or has no interactive form fields, choose Text or Sign and place items manually.</div>
        </section>
        <div class="option-field editor-page-range"><label for="pageRange">Apply placed items to pages</label><input id="pageRange" value="placed" placeholder="placed, all, 1, 3-5"><span class="option-hint">Use “placed” for exact positions. Choose “all” or a page range to repeat the active page's items on other pages.</span></div>
        <div class="editor-sidebar-foot"><span id="placedItemsCount">0 items placed</span><button type="button" class="text-button" id="clearPlacedItemsButton">Clear placed items</button></div>
      </div>`;
      case 'watermark': return `<div class="option-field"><label for="watermarkText">Watermark text</label><input id="watermarkText" value="CONFIDENTIAL" maxlength="100"></div><div class="option-row"><div class="option-field"><label for="watermarkSize">Font size (pt)</label><input id="watermarkSize" type="number" min="10" max="100" value="42"></div><div class="option-field"><label for="watermarkAngle">Angle</label><select id="watermarkAngle"><option value="45">45° diagonal</option><option value="0">Horizontal</option><option value="-45">-45° diagonal</option></select></div></div><div class="option-field"><label for="pageRange">Apply to page(s)</label><input id="pageRange" value="all" placeholder="all or 1, 3-5"></div>`;
      case 'page-numbers': return `<div class="option-row"><div class="option-field"><label for="pageNumberStart">Start numbering at</label><input id="pageNumberStart" type="number" min="0" max="999999" value="1"></div><div class="option-field"><label for="pageNumberPosition">Position</label><select id="pageNumberPosition"><option value="bottom-center">Bottom centre</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-center">Top centre</option></select></div></div><div class="option-field"><label for="pageNumberFormat">Number format</label><select id="pageNumberFormat"><option value="number">1, 2, 3…</option><option value="page">Page 1, Page 2…</option></select></div>`;
      case 'compress': return `<div class="note-box">Basic optimization rewrites the PDF with object streams. It does not resize embedded photos or remove all redundant content, so the result may not be smaller. This tool does not rasterize pages, helping preserve selectable text and vector content.</div>`;
      default: return '';
    }
  }
  function clearPageObserver() { if (state.pageObserver) { state.pageObserver.disconnect(); state.pageObserver = null; } state.pageRenderJobs.clear(); }
  function selectTool(requestedTool) {
    const tool=requestedTool==='add-text'?'sign':requestedTool;
    if (!TOOL[tool]) return;
    clearPageObserver();
    state.tool=tool; state.editorMode=requestedTool==='add-text'?'text':'signature'; state.files=[]; state.previewDoc=null; state.previewFile=null; state.pdfPage=1; state.pageCount=0; state.position={x:.43,y:.62}; state.positionSet=false; state.signatureImageFile=null; state.signatureDrawn=false;
    state.continuousView=false; state.pageItems=[]; state.selectedItemId=null; state.itemCounter=0; state.acroFields=[]; state.acroValues={}; state.previewGeneration++;
    const def=TOOL[tool]; $('workbenchTitle').textContent=def.title; $('workbenchDescription').textContent=def.description;
    $('fillSignToolbar').hidden=tool!=='sign'; $('workbenchTopline').hidden=tool==='sign'; $('workbench').querySelector('.workbench-card').classList.toggle('is-fill-sign',tool==='sign');
    const actionRow=$('runTool')?.closest('.action-row');if(actionRow)actionRow.hidden=tool==='sign';$('runTool').innerHTML=tool==='sign'?'<span>Apply changes &amp; Download</span><span aria-hidden="true">↓</span>':'<span>Process PDF</span><span aria-hidden="true">→</span>';updateEditorItemsStatus();
    $('fileInput').value=''; $('fileInput').accept=def.accept; $('fileInput').multiple=!!def.multiple;
    $('uploadTitle').textContent=def.multiple?'Choose files':'Choose a file';
    $('uploadHint').textContent=tool==='images-to-pdf'?'JPG, PNG and supported browser image formats':(tool==='merge'?'Select two or more PDF files':'PDF file · select from your device');
    $('selectedFiles').hidden=true; $('selectedFiles').innerHTML=''; $('runTool').disabled=true;
    $('toolOptions').innerHTML=optionsHtml(tool);
    if(tool==='sign'){setEditorMode(state.editorMode,false);}
    $('previewEmpty').hidden=false; $('pdfStageWrap').hidden=true; $('pdfStageWrap').classList.remove('is-continuous'); $('previewHeader').classList.remove('is-sticky-page-controls'); $('workbench').querySelector('.workbench-card').classList.remove('is-continuous'); $('pdfStage').hidden=false; $('continuousPages').hidden=true; $('continuousPages').innerHTML=''; $('pageControls').hidden=true; $('previewHelp').hidden=!['sign','add-text'].includes(tool); $('previewMeta').textContent='Your PDF preview will appear here'; $('placementOverlay').hidden=true;
    $('workbench').hidden=false; $('workbench').scrollIntoView({behavior:'smooth',block:'start'});
    const signMode=$('signatureMode');
    if(signMode){
      state.savedSignatures=readSavedSignatures();populateSavedSignatures();
      signMode.addEventListener('change',updateSignatureMode);updateSignatureMode();setupSignaturePad();updateTypedSignaturePreview();
      ['signatureName','signatureStyle','signatureColor'].forEach(id=>$(id).addEventListener(id==='signatureColor'?'input':'input',updateTypedSignaturePreview));
      $('signatureUpload').addEventListener('change',e=>{state.signatureImageFile=e.target.files[0]||null;});
      $('savedSignatureSelect').addEventListener('change',()=>{state.selectedSavedSignatureId=$('savedSignatureSelect').value;});
      $('saveSignatureButton').addEventListener('click',saveCurrentSignature);
      $('deleteSavedSignatureButton').addEventListener('click',deleteSelectedSignature);
      $('signatureWidth').addEventListener('input',()=>{$('signatureWidthValue').textContent=`${$('signatureWidth').value} pt`;});
    }
    if($('textToAdd')){
      $('textToAdd').addEventListener('input',()=>{const item=getSelectedPageItem();if(item&&item.type==='text'){item.text=$('textToAdd').value;updatePageItemNode(item);}});
      ['textFontSize','textColor','textFontFamily','textAlign','textBold','textItalic','coverExistingText'].forEach(id=>$(id).addEventListener('input',syncSelectedTextItem));
      ['textFontFamily','textAlign','textBold','textItalic','coverExistingText'].forEach(id=>$(id).addEventListener('change',syncSelectedTextItem));
    }
    document.querySelectorAll('[data-editor-mode]').forEach(button=>button.onclick=()=>setEditorMode(button.dataset.editorMode));
    document.querySelectorAll('[data-side-panel]').forEach(button=>button.onclick=()=>setEditorMode(button.dataset.sidePanel==='signatureEditorPanel'?'signature':button.dataset.sidePanel==='textEditorPanel'?'text':'forms'));
    const repeatButton=$('repeatAllPagesButton');if(repeatButton)repeatButton.onclick=()=>{if(!state.pageItems.length){setStatus('Place a signature or text item first.','error');return;}if($('pageRange'))$('pageRange').value='all';setStatus('Repeat mode selected. Items already placed on individual pages stay in their own positions; the active page items fill pages without their own items.','success');};
    const downloadButton=$('downloadEditedPdf');if(downloadButton)downloadButton.onclick=()=>runSelectedTool();
    const clearButton=$('clearPlacedItemsButton');if(clearButton)clearButton.onclick=()=>{state.pageItems=[];state.selectedItemId=null;document.querySelectorAll('.page-overlay-layer').forEach(layer=>layer.innerHTML='');updateEditorItemsStatus();setStatus('All placed items cleared.','success');};
    $('closeWorkbench').focus({preventScroll:true}); setStatus('Choose your file(s) to begin.');
  }
  function updateSignatureMode() {
    const mode=$('signatureMode')?.value||'typed';
    $('typedSignatureFields').hidden=mode!=='typed'; $('drawSignatureFields').hidden=mode!=='draw'; $('uploadSignatureFields').hidden=mode!=='upload'; $('savedSignatureFields').hidden=mode!=='saved';
    $('saveSignatureButton').hidden=mode==='saved';
    updatePlacementOverlay();
  }
  function setEditorMode(mode, announce=true) {
    if(!['select','text','signature','forms'].includes(mode))mode='signature';
    state.editorMode=mode;
    document.querySelectorAll('[data-editor-mode]').forEach(button=>button.classList.toggle('is-active',button.dataset.editorMode===mode));
    document.querySelectorAll('[data-side-panel]').forEach(button=>button.classList.toggle('is-active',button.dataset.sidePanel===(mode==='signature'?'signatureEditorPanel':mode==='text'?'textEditorPanel':'formEditorPanel')));
    const signaturePanel=$('signatureEditorPanel'),textPanel=$('textEditorPanel'),formPanel=$('formEditorPanel');
    if(signaturePanel)signaturePanel.hidden=mode!=='signature';if(textPanel)textPanel.hidden=mode!=='text';if(formPanel)formPanel.hidden=mode!=='forms';
    const labels={select:'Select and move items',text:'Click a page to add text',signature:'Click a page to place your signature',forms:'Fill the interactive fields in this PDF'};
    if(announce&&state.tool==='sign')setStatus(labels[mode]||'Ready to edit.', '');
    const pages=$('continuousPages');if(pages)pages.dataset.editorMode=mode;
  }
  function updateEditorItemsStatus(){
    const count=state.pageItems.length;const label=`${count} item${count===1?'':'s'} placed`;
    if($('editorItemsStatus'))$('editorItemsStatus').textContent=label;
    if($('placedItemsCount'))$('placedItemsCount').textContent=label;
    if($('downloadEditedPdf'))$('downloadEditedPdf').disabled=!state.files.length;
  }
  function readSavedSignatures() {
    try { const saved=JSON.parse(localStorage.getItem('eaziply_saved_signatures')||'[]'); return Array.isArray(saved)?saved.filter(x=>x&&x.id&&x.dataUrl).slice(0,8):[]; }
    catch { return []; }
  }
  function writeSavedSignatures() {
    try { localStorage.setItem('eaziply_saved_signatures',JSON.stringify(state.savedSignatures)); return true; }
    catch { setStatus('The browser could not save this signature. Its local storage may be full.','error'); return false; }
  }
  function populateSavedSignatures() {
    const select=$('savedSignatureSelect'); if(!select)return;
    const wanted=state.selectedSavedSignatureId||'';
    select.innerHTML='<option value="">Choose a saved signature</option>';
    state.savedSignatures.forEach(sig=>{const option=document.createElement('option');option.value=sig.id;option.textContent=sig.name||'Saved signature';select.appendChild(option);});
    if(state.savedSignatures.some(sig=>sig.id===wanted))select.value=wanted;
    else if(state.savedSignatures.length){select.value=state.savedSignatures[0].id;state.selectedSavedSignatureId=select.value;}
    $('deleteSavedSignatureButton').disabled=!state.savedSignatures.length;
  }
  function selectedSavedSignature() { const select=$('savedSignatureSelect'); const id=select?select.value:state.selectedSavedSignatureId; return state.savedSignatures.find(sig=>sig.id===id)||null; }
  function dataUrlBytes(dataUrl) {
    const base64=(dataUrl||'').split(',')[1]; if(!base64)throw new Error('Signature image data is not available.');
    const binary=atob(base64);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
  }
  const SIGNATURE_FONTS={
    greatvibes:{family:'"Great Vibes", cursive',size:88},allura:{family:'"Allura", cursive',size:92},dancing:{family:'"Dancing Script", cursive',size:82},satisfy:{family:'"Satisfy", cursive',size:84},pacifico:{family:'"Pacifico", cursive',size:64},caveat:{family:'"Caveat", cursive',size:100},parisienne:{family:'"Parisienne", cursive',size:86},cookie:{family:'"Cookie", cursive',size:96},kaushan:{family:'"Kaushan Script", cursive',size:76},marck:{family:'"Marck Script", cursive',size:92},playball:{family:'"Playball", cursive',size:88},sacramento:{family:'"Sacramento", cursive',size:96}
  };
  async function drawTypedSignature(canvas,asDataUrl=false){
    const text=getOption('signatureName','').trim();if(!text){if(canvas){const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);}if(asDataUrl)throw new Error('Enter your name for the signature first.');return '';}
    const style=getOption('signatureStyle','greatvibes');const def=SIGNATURE_FONTS[style]||SIGNATURE_FONTS.greatvibes;const color=getOption('signatureColor','#17213f');
    try{if(document.fonts?.load)await document.fonts.load(`${def.size}px ${def.family}`,text);}catch{}
    const measureCanvas=canvas||document.createElement('canvas');let ctx=measureCanvas.getContext('2d');ctx.font=`${def.size}px ${def.family}`;const measured=ctx.measureText(text).width;
    // Export signatures use a content-sized canvas; the small on-screen preview keeps its fixed dimensions.
    if(asDataUrl||!canvas){measureCanvas.width=Math.max(360,Math.min(1800,Math.ceil(measured+80)));measureCanvas.height=190;ctx=measureCanvas.getContext('2d');}
    ctx.clearRect(0,0,measureCanvas.width,measureCanvas.height);ctx.font=`${def.size}px ${def.family}`;ctx.fillStyle=color;ctx.textBaseline='middle';ctx.fillText(text,24,measureCanvas.height/2,measureCanvas.width-48);
    return asDataUrl?measureCanvas.toDataURL('image/png'):'';
  }
  async function typedSignatureDataUrl(){const canvas=document.createElement('canvas');await drawTypedSignature(canvas,true);return canvas.toDataURL('image/png');}
  function updateTypedSignaturePreview(){const canvas=$('signaturePreviewCanvas');if(!canvas)return;drawTypedSignature(canvas,false).catch(()=>{});}
  async function getDataUrlAspectRatio(dataUrl) {
    const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Could not prepare the signature image.'));image.src=dataUrl;});
    return img.naturalWidth/Math.max(1,img.naturalHeight);
  }
  async function uploadedSignatureDataUrl(file) {
    if(!file)throw new Error('Choose a signature image first.');
    const source=await new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not open the signature image.'));};img.src=url;});
    const scale=Math.min(1,600/source.naturalWidth,180/source.naturalHeight);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));canvas.getContext('2d').drawImage(source,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
  }
  async function currentSignatureDataUrl() {
    const mode=getOption('signatureMode','typed');
    if(mode==='saved'){const sig=selectedSavedSignature();if(!sig)throw new Error('Choose a saved signature first.');return sig.dataUrl;}
    if(mode==='draw'){const pad=$('signaturePad');if(!state.signatureDrawn)throw new Error('Draw your signature in the signature box first.');return pad.toDataURL('image/png');}
    if(mode==='upload')return await uploadedSignatureDataUrl(state.signatureImageFile);
    return typedSignatureDataUrl();
  }
  async function saveCurrentSignature() {
    try {
      const dataUrl=await currentSignatureDataUrl();
      const mode=getOption('signatureMode','typed');
      const name=mode==='typed'?getOption('signatureName','').trim():(mode==='upload'?(state.signatureImageFile?.name||'Uploaded signature'):'Drawn signature');
      const entry={id:`sig-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,name:name.slice(0,80),dataUrl,createdAt:new Date().toISOString()};
      state.savedSignatures=readSavedSignatures();state.savedSignatures=state.savedSignatures.filter(x=>!(x.name===entry.name&&x.dataUrl===entry.dataUrl));state.savedSignatures.unshift(entry);state.savedSignatures=state.savedSignatures.slice(0,8);
      if(!writeSavedSignatures())return;
      state.selectedSavedSignatureId=entry.id;populateSavedSignatures();$('signatureMode').value='saved';updateSignatureMode();
      setStatus('Signature saved on this device. You can reuse it in future Eaziply visits.','success');toast('Signature saved for reuse.');
    } catch(err){setStatus(err.message||'Could not save this signature.','error');}
  }
  function deleteSelectedSignature() {
    const sig=selectedSavedSignature();if(!sig)return;
    state.savedSignatures=state.savedSignatures.filter(item=>item.id!==sig.id);state.selectedSavedSignatureId='';writeSavedSignatures();populateSavedSignatures();updatePlacementOverlay();setStatus('Saved signature deleted from this browser.','success');
  }
  function setupSignaturePad() {
    const canvas=$('signaturePad'); if(!canvas) return;
    const ctx=canvas.getContext('2d'); ctx.lineWidth=4; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle='#17213f';
    let drawing=false, last=null;
    const point=e=>{const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};};
    canvas.addEventListener('pointerdown',e=>{drawing=true; last=point(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.strokeStyle=$('signatureColor')?.value||'#17213f';state.signatureDrawn=true; e.preventDefault();});
    canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);ctx.lineTo(p.x,p.y);ctx.stroke();last=p;updatePlacementOverlay();e.preventDefault();});
    const stop=()=>{drawing=false;last=null;updatePlacementOverlay();}; canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
    $('clearSignaturePad')?.addEventListener('click',()=>{ctx.clearRect(0,0,canvas.width,canvas.height);state.signatureDrawn=false;updatePlacementOverlay();});
  }
  function safeFormLabel(value){return String(value||'Unnamed field').replace(/\s+/g,' ').trim().slice(0,110);}
  function classifyPdfField(field){
    if(window.PDFLib?.PDFTextField&&field instanceof PDFLib.PDFTextField)return 'text';
    if(window.PDFLib?.PDFCheckBox&&field instanceof PDFLib.PDFCheckBox)return 'checkbox';
    if(window.PDFLib?.PDFDropdown&&field instanceof PDFLib.PDFDropdown)return 'dropdown';
    if(window.PDFLib?.PDFRadioGroup&&field instanceof PDFLib.PDFRadioGroup)return 'radio';
    if(window.PDFLib?.PDFOptionList&&field instanceof PDFLib.PDFOptionList)return 'list';
    const name=field?.constructor?.name||'';if(name.includes('TextField'))return 'text';if(name.includes('CheckBox'))return 'checkbox';if(name.includes('Dropdown'))return 'dropdown';if(name.includes('RadioGroup'))return 'radio';if(name.includes('OptionList'))return 'list';return 'unsupported';
  }
  async function inspectAcroFormFields(file){
    state.acroFields=[];state.acroValues={};const host=$('acroFormFields');if(!host)return;
    host.innerHTML='<p class="option-hint">Checking this PDF for interactive form fields…</p>';
    try{
      const doc=await loadPdfLib(file);const form=doc.getForm();const fields=form.getFields();
      state.acroFields=fields.map(field=>{const name=field.getName();const type=classifyPdfField(field);let value='';let options=[];try{if(type==='text')value=field.getText()||'';else if(type==='checkbox')value=field.isChecked()?'true':'false';else if(type==='dropdown'||type==='list'){value=field.getSelected()?.[0]||'';options=field.getOptions?.()||[];}else if(type==='radio')value=field.getSelected()||'';}catch{}return {name,type,value,options};}).filter(x=>x.type!=='unsupported');
      state.acroFields.forEach(field=>{state.acroValues[field.name]=field.value;});renderAcroFormFields();
    }catch(err){state.acroFields=[];host.innerHTML='<p class="option-hint">This PDF could not expose interactive fields. You can still use Text and Sign to fill it manually.</p>';}
  }
  function renderAcroFormFields(){
    const host=$('acroFormFields');if(!host)return;host.innerHTML='';
    if(!state.acroFields.length){host.innerHTML='<div class="empty-fields"><strong>No interactive fields found</strong><span>Choose Text or Sign and click the page to fill a flat or scanned form manually.</span></div>';return;}
    const heading=document.createElement('p');heading.className='option-hint';heading.textContent=`${state.acroFields.length} interactive field(s) detected. Fill them here or click the highlighted field on the page.`;host.appendChild(heading);
    state.acroFields.forEach((field,index)=>{
      const wrap=document.createElement('label');wrap.className='acro-field-row';const title=document.createElement('span');title.className='acro-field-label';title.textContent=safeFormLabel(field.name);wrap.appendChild(title);let control;
      if(field.type==='checkbox'){control=document.createElement('input');control.type='checkbox';control.checked=String(state.acroValues[field.name]??field.value)==='true';control.addEventListener('change',()=>state.acroValues[field.name]=control.checked?'true':'false');}
      else if(field.type==='dropdown'||field.type==='list'||field.type==='radio'){
        control=document.createElement('select');const values=field.options.length?field.options:[String(field.value||'')].filter(Boolean);const blank=document.createElement('option');blank.value='';blank.textContent='Choose…';control.appendChild(blank);values.forEach(value=>{const opt=document.createElement('option');opt.value=String(value);opt.textContent=String(value);control.appendChild(opt);});control.value=String(state.acroValues[field.name]||'');control.addEventListener('change',()=>state.acroValues[field.name]=control.value);
      }else{control=document.createElement('input');control.type='text';control.value=String(state.acroValues[field.name]??field.value??'');control.placeholder='Enter value';control.addEventListener('input',()=>state.acroValues[field.name]=control.value);}
      control.className='control';control.dataset.acroField=field.name;wrap.appendChild(control);host.appendChild(wrap);
    });
  }
  async function applyAcroFormValues(doc){
    const entries=Object.entries(state.acroValues||{}).filter(([,value])=>value!==undefined&&value!==null);if(!entries.length)return;
    const form=doc.getForm();const fields=new Map(form.getFields().map(field=>[field.getName(),field]));
    for(const [name,value] of entries){const field=fields.get(name);if(!field)continue;const type=classifyPdfField(field);try{if(type==='text')field.setText(String(value));else if(type==='checkbox'){if(String(value)==='true')field.check();else field.uncheck();}else if(type==='dropdown'||type==='list'||type==='radio'){if(String(value))field.select(String(value));}}catch(err){console.warn('Could not set PDF form field',name,err);}}
    try{form.updateFieldAppearances();}catch{}
  }
  async function renderPageAcroWidgets(pageNumber,page,viewport,surface){
    const layer=surface.querySelector('.acro-widget-layer');if(!layer||layer.dataset.rendered==='true')return;
    try{
      const annotations=await page.getAnnotations({intent:'display'});const widgets=annotations.filter(a=>a.subtype==='Widget'&&a.fieldName&&a.fieldType&&Array.isArray(a.rect));
      widgets.forEach(annotation=>{
        const rect=viewport.convertToViewportRectangle(annotation.rect);const left=Math.min(rect[0],rect[2]),top=Math.min(rect[1],rect[3]),width=Math.abs(rect[2]-rect[0]),height=Math.abs(rect[3]-rect[1]);if(width<5||height<5)return;
        const shell=document.createElement('div');shell.className='acro-widget-shell';shell.style.left=`${left}px`;shell.style.top=`${top}px`;shell.style.width=`${width}px`;shell.style.height=`${height}px`;
        let control;const name=annotation.fieldName;const value=state.acroValues[name]??annotation.fieldValue??'';
        if(annotation.fieldType==='Btn'){
          const isRadio=!!(Number(annotation.fieldFlags||0)&32768);
          control=document.createElement('input');control.type=isRadio?'radio':'checkbox';
          if(isRadio){const optionValue=String(annotation.buttonValue??annotation.exportValue??'Yes');control.name=`eaziply-radio-${name}`;control.checked=String(value)===optionValue;control.addEventListener('change',()=>{if(control.checked){state.acroValues[name]=optionValue;document.querySelectorAll(`input[name=\"eaziply-radio-${CSS.escape(name)}\"]`).forEach(input=>{if(input!==control)input.checked=input.value===optionValue;});}});control.value=optionValue;}
          else{control.checked=String(value)!==''&&String(value)!=='Off'&&String(value)!=='false';control.addEventListener('change',()=>state.acroValues[name]=control.checked?'true':'false');}
        }else if(annotation.fieldType==='Ch'){
          control=document.createElement('select');(annotation.options||[]).forEach(entry=>{const opt=document.createElement('option');opt.value=String(entry.exportValue??entry.displayValue??entry);opt.textContent=String(entry.displayValue??entry.exportValue??entry);control.appendChild(opt);});control.value=String(value);control.addEventListener('change',()=>state.acroValues[name]=control.value);
        }else if(annotation.fieldType==='Tx'){
          control=document.createElement('input');control.type='text';control.value=String(value);control.addEventListener('input',()=>{state.acroValues[name]=control.value;const side=$('acroFormFields')?.querySelector(`[data-acro-field="${CSS.escape(name)}"]`);if(side&&side!==control)side.value=control.value;});
        }else return;
        control.className='acro-widget-control';control.setAttribute('aria-label',safeFormLabel(name));if(annotation.readOnly)control.disabled=true;control.addEventListener('click',e=>e.stopPropagation());shell.appendChild(control);layer.appendChild(shell);
      });layer.dataset.rendered='true';
    }catch(err){layer.dataset.rendered='true';}
  }
  function fileListText() {
    const wrap=$('selectedFiles');wrap.innerHTML='';
    state.files.forEach((file,index)=>{const row=document.createElement('div');row.className='file-chip';const icon=document.createElement('span');icon.textContent='▣';const name=document.createElement('span');name.textContent=file.name;const size=document.createElement('span');size.textContent=humanBytes(file.size);row.append(icon,name,size); if(['merge','images-to-pdf'].includes(state.tool)){const controls=document.createElement('span');controls.className='file-order-controls';const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='Move up';up.disabled=index===0;up.addEventListener('click',()=>{if(index>0){[state.files[index-1],state.files[index]]=[state.files[index],state.files[index-1]];fileListText();}});const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='Move down';down.disabled=index===state.files.length-1;down.addEventListener('click',()=>{if(index<state.files.length-1){[state.files[index+1],state.files[index]]=[state.files[index],state.files[index+1]];fileListText();}});controls.append(up,down);row.appendChild(controls);} wrap.appendChild(row);});
    wrap.hidden=!state.files.length;
  }
  async function onFilesChanged(files) {
    const generation=++state.previewGeneration;clearPageObserver(); state.files=Array.from(files||[]); state.previewDoc=null;state.previewFile=null;state.pdfPage=1;state.pageCount=0;state.signatureImageFile=null;state.position={x:.43,y:.62};state.positionSet=false;state.pageItems=[];state.selectedItemId=null;state.acroFields=[];state.acroValues={};if($('acroFormFields'))$('acroFormFields').innerHTML='<p class="option-hint">Checking for interactive fields…</p>';updateEditorItemsStatus();
    fileListText(); $('continuousPages').innerHTML=''; $('continuousPages').hidden=true; $('pdfStage').hidden=false; $('pdfStageWrap').classList.remove('is-continuous');
    if(state.files.some(f=>f.size>80*1024*1024)){setStatus('Each file must be 80 MB or smaller for this browser-based version.','error');$('runTool').disabled=true;return;}
    if(state.files.reduce((sum,f)=>sum+f.size,0)>150*1024*1024){setStatus('This selection is over 150 MB total. Process fewer or smaller files to avoid running out of browser memory.','error');$('runTool').disabled=true;return;}
    if(!state.files.length){$('runTool').disabled=true;return;}
    if(state.tool==='merge' && state.files.length<2){setStatus('Select at least two PDF files to merge.','error');$('runTool').disabled=true;return;}
    if(!['images-to-pdf'].includes(state.tool) && state.files.some(f=>!isPdf(f))){setStatus('This tool needs PDF files. Please select a PDF.','error');$('runTool').disabled=true;return;}
    if(state.tool==='images-to-pdf' && state.files.some(f=>!f.type.startsWith('image/'))){setStatus('Please select image files only.','error');$('runTool').disabled=true;return;}
    $('runTool').disabled=false;
    const totalBytes=state.files.reduce((sum,f)=>sum+f.size,0);setStatus(`${state.files.length} file(s) selected · ${humanBytes(totalBytes)} total.`);
    if(state.files[0] && isPdf(state.files[0])) {
      try {
        setStatus('Loading PDF preview…','busy');state.previewFile=state.files[0];const loadedDoc=await loadPdfJs(state.previewFile);if(generation!==state.previewGeneration)return;state.previewDoc=loadedDoc;state.pageCount=state.previewDoc.numPages;
        state.continuousView=state.tool==='sign';
        $('pageControls').hidden=false;updatePageControls();$('pdfStageWrap').hidden=false;$('previewEmpty').hidden=true;
        if(state.continuousView){
          $('pdfStage').hidden=true;$('continuousPages').hidden=false;$('pdfStageWrap').classList.add('is-continuous');$('previewHeader').classList.add('is-sticky-page-controls');$('workbench').querySelector('.workbench-card').classList.add('is-continuous');
          await renderContinuousPages(generation);
        } else {
          $('continuousPages').hidden=true;$('pdfStage').hidden=false;$('pdfStageWrap').classList.remove('is-continuous');$('previewHeader').classList.remove('is-sticky-page-controls');$('workbench').querySelector('.workbench-card').classList.remove('is-continuous');await renderCurrentPage();
        }
        if(generation!==state.previewGeneration)return;if(state.tool==='sign')await inspectAcroFormFields(state.files[0]);
        $('previewMeta').textContent=`${state.pageCount} page(s) · ${humanBytes(state.previewFile.size)}`;
        setStatus(`${state.files.length} file(s) selected. ${state.continuousView?'Continuous multi-page preview':'PDF preview'} is ready.`,'success');
      } catch(err) {
        $('previewEmpty').hidden=false;$('pdfStageWrap').hidden=true;$('pageControls').hidden=true;setStatus(`File selected, but preview failed: ${humanError(err)}`,'error');
      }
    } else {
      $('previewEmpty').hidden=false;$('pdfStageWrap').hidden=true;$('pageControls').hidden=true;
      $('previewEmpty').querySelector('strong').textContent='Image files selected';$('previewEmpty').querySelector('span:last-child').textContent='The selected images will be placed into a PDF in the order shown on the left.';
      $('previewMeta').textContent=`${state.files.length} image(s) · ${humanBytes(totalBytes)}`;setStatus(`${state.files.length} image(s) ready to combine into PDF.`,'success');
    }
    updatePlacementOverlay();
  }
  function updatePageControls() {
    const total=state.pageCount||1;const input=$('pageJumpInput');input.max=String(total);if(document.activeElement!==input)input.value=String(Math.min(total,Math.max(1,state.pdfPage||1)));
    if($('downloadEditedPdf'))$('downloadEditedPdf').disabled=!state.files.length;
    $('pageCountLabel').textContent=String(total);$('prevPage').disabled=state.pdfPage<=1;$('nextPage').disabled=state.pdfPage>=total;
  }
  async function jumpToPage(value) {
    if(!state.previewDoc)return;const page=Math.max(1,Math.min(state.pageCount,Math.floor(Number(value)||1)));state.pdfPage=page;updatePageControls();
    if(state.continuousView){const target=$(`continuousPage${page}`);if(target)target.scrollIntoView({behavior:'smooth',block:'start'});const canvas=target?.querySelector('canvas');if(canvas&&!canvas.dataset.rendered)renderContinuousPage(page,state.previewGeneration);}
    else await renderCurrentPage();
  }
  async function renderCurrentPage() {
    if(!state.previewDoc) return;
    const page=await state.previewDoc.getPage(state.pdfPage);const base=page.getViewport({scale:1});const maxWidth=Math.max(180,Math.min(720,($('previewColumn')?.clientWidth||780)-40));
    const scale=Math.min(maxWidth/base.width,1.4);state.viewScale=scale;state.previewPageWidth=base.width;const viewport=page.getViewport({scale});
    const canvas=$('pdfCanvas');canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);canvas.style.width=`${Math.floor(viewport.width)}px`;canvas.style.height=`${Math.floor(viewport.height)}px`;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport}).promise;
    $('previewEmpty').hidden=true;$('pdfStageWrap').hidden=false;$('pdfStage').hidden=false;$('continuousPages').hidden=true;$('pdfStageWrap').classList.remove('is-continuous');$('pdfStage').style.width=`${canvas.width}px`;$('pdfStage').style.height=`${canvas.height}px`;
    updatePageControls();updatePlacementOverlay();
  }
  async function renderContinuousPages(generation=state.previewGeneration) {
    const container=$('continuousPages');container.innerHTML='';clearPageObserver();
    const doc=state.previewDoc;const count=state.pageCount;
    const maxWidth=Math.max(180,Math.min(700,($('previewColumn')?.clientWidth||780)-32));
    for(let number=1;number<=count;number++){
      if(generation!==state.previewGeneration||doc!==state.previewDoc)return;
      const page=await doc.getPage(number);if(generation!==state.previewGeneration||doc!==state.previewDoc)return;
      const base=page.getViewport({scale:1});const scale=Math.min(maxWidth/base.width,1.25);const viewport=page.getViewport({scale});
      const card=document.createElement('article');card.className='pdf-page-item';card.id=`continuousPage${number}`;card.dataset.pageNumber=String(number);
      const label=document.createElement('div');label.className='pdf-page-label';label.innerHTML=`<strong>Page ${number}</strong><span>${Math.round(base.width)} × ${Math.round(base.height)} pt</span>`;
      const surface=document.createElement('div');surface.className='pdf-page-surface';surface.dataset.pageNumber=String(number);surface.dataset.scale=String(scale);surface.style.width=`${Math.floor(viewport.width)}px`;surface.style.height=`${Math.floor(viewport.height)}px`;
      surface.dataset.canvasWidth=String(Math.floor(viewport.width));surface.dataset.canvasHeight=String(Math.floor(viewport.height));
      const placeholder=document.createElement('div');placeholder.className='pdf-page-canvas-placeholder';placeholder.setAttribute('aria-label',`Preview placeholder for page ${number}`);
      const layer=document.createElement('div');layer.className='page-overlay-layer';layer.dataset.pageNumber=String(number);
      const formLayer=document.createElement('div');formLayer.className='acro-widget-layer';formLayer.dataset.pageNumber=String(number);
      surface.append(placeholder,layer,formLayer);card.append(label,surface);container.appendChild(card);
      surface.addEventListener('click',e=>handlePagePlacementClick(e,number,surface));renderPageItems(number);
    }
    if(generation!==state.previewGeneration||doc!==state.previewDoc)return;
    if('IntersectionObserver' in window){
      state.pageObserver=new IntersectionObserver(entries=>{if(generation!==state.previewGeneration)return;entries.forEach(entry=>{const n=Number(entry.target.dataset.pageNumber);if(entry.isIntersecting){renderContinuousPage(n,generation);}else{const r=entry.target.getBoundingClientRect();const distance=r.top>window.innerHeight?r.top-window.innerHeight:(r.bottom<0?-r.bottom:0);if(distance>850)unloadContinuousPage(n,generation);}});},{root:null,rootMargin:'900px 0px'});
      container.querySelectorAll('.pdf-page-item').forEach(card=>state.pageObserver.observe(card));
    } else {
      for(let number=1;number<=count;number++){if(generation!==state.previewGeneration)return;await renderContinuousPage(number,generation);}
    }
    updatePageControls();
  }
  async function renderContinuousPage(number,generation=state.previewGeneration) {
    const card=$(`continuousPage${number}`);const surface=card?.querySelector('.pdf-page-surface');const doc=state.previewDoc;const key=`${generation}:${number}`;
    if(!surface||surface.dataset.rendered==='true'||state.pageRenderJobs.has(key)||!doc)return;
    let job;
    job=(async()=>{let canvas=null;try{
      const page=await doc.getPage(number);if(generation!==state.previewGeneration||doc!==state.previewDoc||!surface.isConnected)return;
      const base=page.getViewport({scale:1});const maxWidth=Math.max(180,Math.min(700,($('previewColumn')?.clientWidth||780)-32));const scale=Math.min(maxWidth/base.width,1.25);const viewport=page.getViewport({scale});
      const width=Number(surface.dataset.canvasWidth)||Math.floor(viewport.width);const height=Number(surface.dataset.canvasHeight)||Math.floor(viewport.height);
      canvas=document.createElement('canvas');canvas.className='pdf-page-canvas';canvas.width=width;canvas.height=height;canvas.style.width=`${width}px`;canvas.style.height=`${height}px`;canvas.dataset.rendered='false';
      const layer=surface.querySelector('.page-overlay-layer');surface.insertBefore(canvas,layer||null);
      const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);await page.render({canvasContext:ctx,viewport,renderInteractiveForms:true}).promise;
      if(generation!==state.previewGeneration||doc!==state.previewDoc||!surface.isConnected){canvas.width=0;canvas.height=0;canvas.remove();return;}
      canvas.dataset.rendered='true';surface.dataset.rendered='true';surface.querySelector('.pdf-page-canvas-placeholder')?.remove();if(state.tool==='sign')await renderPageAcroWidgets(number,page,viewport,surface);
    }catch(err){if(canvas){canvas.width=0;canvas.height=0;canvas.remove();}if(generation===state.previewGeneration){const layer=surface.querySelector('.page-overlay-layer');if(layer&&!layer.querySelector('.page-render-error')){const msg=document.createElement('div');msg.className='page-render-error';msg.textContent='This page preview could not render. Try reloading the PDF or use a smaller file.';layer.appendChild(msg);}}}finally{if(state.pageRenderJobs.get(key)===job)state.pageRenderJobs.delete(key);}})();
    state.pageRenderJobs.set(key,job);await job;
  }
  function unloadContinuousPage(number,generation=state.previewGeneration) {
    if(state.pageRenderJobs.has(`${generation}:${number}`))return;const card=$(`continuousPage${number}`);const surface=card?.querySelector('.pdf-page-surface');const canvas=surface?.querySelector('canvas.pdf-page-canvas');
    if(!surface||!canvas||canvas.dataset.rendered!=='true')return;
    canvas.width=0;canvas.height=0;canvas.remove();surface.dataset.rendered='false';
    if(!surface.querySelector('.pdf-page-canvas-placeholder')){const placeholder=document.createElement('div');placeholder.className='pdf-page-canvas-placeholder';placeholder.setAttribute('aria-label',`Preview placeholder for page ${number}`);surface.insertBefore(placeholder,surface.querySelector('.page-overlay-layer')||null);}
  }
  function updateCurrentPageFromScroll() {
    if(!state.continuousView)return;const cards=[...$('continuousPages').querySelectorAll('.pdf-page-item')];if(!cards.length)return;
    const anchor=155;let active=cards[0];for(const card of cards){const r=card.getBoundingClientRect();if(r.top<=anchor)active=card;else break;}
    const next=Number(active.dataset.pageNumber)||1;if(next!==state.pdfPage){state.pdfPage=next;updatePageControls();}
  }
  function getOption(id, fallback='') { const el=$(id);return el?el.value:fallback; }
  function updatePlacementOverlay() {
    const overlay=$('placementOverlay');if(!overlay)return;
    if(state.continuousView){overlay.hidden=true;return;}
    overlay.hidden=true;
  }
  function getSelectedPageItem(){return state.pageItems.find(item=>item.id===state.selectedItemId)||null;}
  function itemNode(id){return document.querySelector(`[data-overlay-item="${CSS.escape(String(id))}"]`);}
  function applyItemAppearance(item,node){
    if(!node)return;node.style.left=`${item.x*100}%`;node.style.top=`${item.y*100}%`;node.style.width=`${Math.max(.06,Math.min(.9,item.w))*100}%`;
    if(item.type==='text'){node.style.height=`${Math.max(.035,Math.min(.7,item.h||.065))*100}%`;const content=node.querySelector('.overlay-text-content');if(content){const scale=Number(node.closest('.pdf-page-surface')?.dataset.scale||1);content.style.fontSize=`${Math.max(6,Math.min(72,item.fontSize||12))*scale}px`;content.style.color=item.color||'#111827';content.style.fontFamily=({helvetica:'Arial, sans-serif',times:'Georgia, serif',courier:'Courier New, monospace'}[item.fontFamily]||'Arial, sans-serif');content.style.fontWeight=item.bold?'700':'400';content.style.fontStyle=item.italic?'italic':'normal';content.style.textAlign=item.align||'left';}}
    else {node.style.height='auto';const img=node.querySelector('.overlay-signature-image');if(img)img.style.width='100%';}
    node.classList.toggle('is-selected',item.id===state.selectedItemId);
  }
  function updatePageItemNode(item){const node=itemNode(item.id);applyItemAppearance(item,node);if(item.type==='text'){const content=node?.querySelector('.overlay-text-content');if(content&&content.textContent!==item.text)content.textContent=item.text||'';}}
  function renderPageItems(pageNumber){
    const layer=document.querySelector(`.page-overlay-layer[data-page-number="${pageNumber}"]`);if(!layer)return;layer.innerHTML='';
    state.pageItems.filter(item=>item.page===pageNumber).forEach(item=>{
      const node=document.createElement('div');node.className=`pdf-overlay-item ${item.type==='signature'?'signature-overlay-item':'text-overlay-item'}`;node.dataset.overlayItem=String(item.id);node.dataset.pageNumber=String(pageNumber);
      const toolbar=document.createElement('div');toolbar.className='overlay-item-toolbar';
      const handle=document.createElement('button');handle.type='button';handle.className='overlay-drag-handle';handle.title='Drag to move';handle.setAttribute('aria-label','Move item');handle.textContent='⠿';
      const duplicate=document.createElement('button');duplicate.type='button';duplicate.className='overlay-duplicate-button';duplicate.title='Duplicate item on this page';duplicate.setAttribute('aria-label','Duplicate item');duplicate.textContent='＋';
      const remove=document.createElement('button');remove.type='button';remove.className='overlay-delete-button';remove.title='Remove item';remove.setAttribute('aria-label','Remove item');remove.textContent='×';
      toolbar.append(handle,duplicate,remove);node.appendChild(toolbar);
      if(item.type==='signature'){const img=document.createElement('img');img.className='overlay-signature-image';img.src=item.dataUrl;img.alt='Signature preview';node.appendChild(img);}
      else {const content=document.createElement('div');content.className='overlay-text-content';content.contentEditable='true';content.spellcheck=false;content.setAttribute('role','textbox');content.setAttribute('aria-label','Text to place on PDF');content.dataset.placeholder='Type your text';content.textContent=item.text||'';content.addEventListener('focus',()=>selectPageItem(item.id));content.addEventListener('input',()=>{item.text=content.innerText.replace(/\r/g,'');if(state.selectedItemId===item.id&&$('textToAdd'))$('textToAdd').value=item.text;updateEditorItemsStatus();});content.addEventListener('paste',e=>{e.preventDefault();const text=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,text);});node.appendChild(content);}
      ['nw','ne','sw','se'].forEach(corner=>{const resize=document.createElement('button');resize.type='button';resize.className=`overlay-resize-handle resize-${corner}`;resize.dataset.corner=corner;resize.title='Resize item';resize.setAttribute('aria-label',`Resize item ${corner}`);node.appendChild(resize);resize.addEventListener('pointerdown',e=>startItemPointerAction(e,item,node,'resize',corner));});
      node.addEventListener('pointerdown',e=>{if(e.target.closest('.overlay-item-toolbar,.overlay-text-content,.overlay-resize-handle'))return;selectPageItem(item.id);startItemPointerAction(e,item,node,'move');});
      handle.addEventListener('pointerdown',e=>startItemPointerAction(e,item,node,'move'));
      duplicate.addEventListener('click',e=>{e.stopPropagation();const copy={...item,id:++state.itemCounter,x:Math.min(.88,item.x+.025),y:Math.min(.92,item.y+.025)};state.pageItems.push(copy);state.selectedItemId=copy.id;renderPageItems(pageNumber);updateEditorItemsStatus();});
      remove.addEventListener('click',e=>{e.stopPropagation();state.pageItems=state.pageItems.filter(x=>x.id!==item.id);if(state.selectedItemId===item.id)state.selectedItemId=null;renderPageItems(pageNumber);updateEditorItemsStatus();setStatus('Item removed from page.','success');});
      layer.appendChild(node);applyItemAppearance(item,node);
    });
  }
  function selectPageItem(id){
    state.selectedItemId=id;const item=getSelectedPageItem();if(!item)return;
    document.querySelectorAll('.pdf-overlay-item').forEach(node=>node.classList.toggle('is-selected',node.dataset.overlayItem===String(id)));
    if(item.type==='signature')setEditorMode('signature',false);
    if(item.type==='text'&&$('textToAdd')){$('textToAdd').value=item.text||'';$('textFontSize').value=String(item.fontSize||12);$('textColor').value=item.color||'#111827';$('textFontFamily').value=item.fontFamily||'helvetica';$('textAlign').value=item.align||'left';$('textBold').checked=!!item.bold;$('textItalic').checked=!!item.italic;$('coverExistingText').checked=!!item.cover;setEditorMode('text',false);}
  }
  function syncSelectedTextItem(){
    const item=getSelectedPageItem();if(!item||item.type!=='text')return;
    item.fontSize=Math.max(6,Math.min(72,Number(getOption('textFontSize','12'))||12));item.color=getOption('textColor','#111827');item.fontFamily=getOption('textFontFamily','helvetica');item.align=getOption('textAlign','left');item.bold=$('textBold').checked;item.italic=$('textItalic').checked;item.cover=$('coverExistingText').checked;updatePageItemNode(item);
  }
  function startItemPointerAction(event,item,node,action,corner='se'){
    event.preventDefault();event.stopPropagation();selectPageItem(item.id);const surface=node.closest('.pdf-page-surface');if(!surface)return;const rect=surface.getBoundingClientRect();const start={x:event.clientX,y:event.clientY,itemX:item.x,itemY:item.y,w:item.w,h:item.h||.065};
    const move=e=>{const dx=(e.clientX-start.x)/rect.width,dy=(e.clientY-start.y)/rect.height;
      if(action==='move'){item.x=Math.max(0,Math.min(1-item.w,start.itemX+dx));item.y=Math.max(0,Math.min(.98,start.itemY+dy));}
      else if(item.type==='text'){
        let x=start.itemX,y=start.itemY,w=start.w,h=start.h;
        if(corner.includes('e'))w=Math.max(.07,Math.min(1-x,start.w+dx));if(corner.includes('s'))h=Math.max(.045,Math.min(1-y,start.h+dy));
        if(corner.includes('w')){const right=start.itemX+start.w;x=Math.max(0,Math.min(right-.07,start.itemX+dx));w=right-x;}
        if(corner.includes('n')){const bottom=start.itemY+start.h;y=Math.max(0,Math.min(bottom-.045,start.itemY+dy));h=bottom-y;}
        item.x=x;item.y=y;item.w=w;item.h=h;
      } else {
        const aspect=Math.max(.2,Math.min(8,Number(item.aspectRatio)||3.2));
        const widthDelta=corner.includes('w')?-dx:dx;
        const heightDelta=(corner.includes('n')?-dy:dy)*(rect.height/rect.width)*aspect;
        const delta=Math.abs(dx)*rect.width>=Math.abs(dy)*rect.height?widthDelta:heightDelta;
        const nextW=Math.max(.07,Math.min(.92,start.w+delta));
        if(corner.includes('w'))item.x=Math.max(0,Math.min(start.itemX+start.w-.07,start.itemX+(start.w-nextW)));
        item.w=nextW;
        if(corner.includes('n'))item.y=Math.max(0,Math.min(.95,start.itemY+(start.w-nextW)*rect.width/(rect.height*aspect)));
      }
      applyItemAppearance(item,node);
    };
    const stop=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stop);window.removeEventListener('pointercancel',stop);};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',stop,{once:true});window.addEventListener('pointercancel',stop,{once:true});
  }
  async function handlePagePlacementClick(event,pageNumber,surface){
    if(state.tool!=='sign'||!state.continuousView)return;
    if(event.target.closest('.pdf-overlay-item,.acro-widget-layer,.acro-widget-shell,.acro-widget-control'))return;
    const rect=surface.getBoundingClientRect();const x=Math.max(0,Math.min(.94,(event.clientX-rect.left)/rect.width));const y=Math.max(0,Math.min(.96,(event.clientY-rect.top)/rect.height));
    if(state.editorMode==='select'||state.editorMode==='forms')return;
    if(state.editorMode==='signature'){
      try{const dataUrl=await currentSignatureDataUrl();const pdfPage=await state.previewDoc.getPage(pageNumber);const widthPt=Math.max(35,Math.min(400,Number(getOption('signatureWidth','150'))||150));const w=Math.max(.07,Math.min(.85,widthPt/pdfPage.getViewport({scale:1}).width));const aspectRatio=await getDataUrlAspectRatio(dataUrl);
        const item={id:++state.itemCounter,type:'signature',page:pageNumber,x,y,w,dataUrl,aspectRatio};state.pageItems.push(item);state.selectedItemId=item.id;renderPageItems(pageNumber);selectPageItem(item.id);updateEditorItemsStatus();setStatus(`Signature placed on page ${pageNumber}. Drag it to move or use a corner handle to resize.`,'success');
      }catch(err){setStatus(err.message||'Choose or create a signature first.','error');}
    } else if(state.editorMode==='text'){
      const item={id:++state.itemCounter,type:'text',page:pageNumber,x,y,w:.42,h:.065,text:getOption('textToAdd',''),fontSize:Math.max(6,Math.min(72,Number(getOption('textFontSize','12'))||12)),color:getOption('textColor','#111827'),fontFamily:getOption('textFontFamily','helvetica'),align:getOption('textAlign','left'),bold:!!$('textBold')?.checked,italic:!!$('textItalic')?.checked,cover:!!$('coverExistingText')?.checked};
      state.pageItems.push(item);state.selectedItemId=item.id;renderPageItems(pageNumber);selectPageItem(item.id);updateEditorItemsStatus();setStatus(`Text box placed on page ${pageNumber}. Type in the box, then drag it to position.`,'success');
      const content=itemNode(item.id)?.querySelector('.overlay-text-content');content?.focus();
    }
  }
  function setupPlacementEvents() {
    $('pdfCanvas').addEventListener('click',e=>{
      if(!state.tool||!['sign','add-text'].includes(state.tool)||!state.previewDoc||state.continuousView)return;
      const r=$('pdfCanvas').getBoundingClientRect();state.position={x:Math.max(0,Math.min(.94,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(.94,(e.clientY-r.top)/r.height))};state.positionSet=true;updatePlacementOverlay();
    });
  }
  function humanError(err) {
    const msg=String(err?.message||err||'Unknown error');
    if(/encrypted|password/i.test(msg)) return 'This PDF may be password-protected. Password-protected PDFs are not supported in this version.';
    if(/worker|fetch|network|load/i.test(msg)) return 'A browser library or PDF could not load. Check your internet connection and try again.';
    return msg.length>240?msg.slice(0,237)+'…':msg;
  }
  function hexRgb(hex) { const v=(hex||'#111827').replace('#','');const n=parseInt(v.length===3?v.split('').map(c=>c+c).join(''):v,16);return PDFLib.rgb(((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255); }
  async function getSignaturePng() { return dataUrlBytes(await currentSignatureDataUrl()); }
  async function imageFileToPngBytes(file) {
    if(file.type==='image/png')return new Uint8Array(await file.arrayBuffer());
    const blob=await new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);c.toBlob(b=>b?resolve(b):reject(new Error('Could not convert signature image.')),'image/png');};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not open the signature image.'));};img.src=url;});return new Uint8Array(await blob.arrayBuffer());
  }
  async function imageFileToJpegBytes(file, quality=.92) {
    if(file.type==='image/jpeg') return new Uint8Array(await file.arrayBuffer());
    const blob=await new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0);URL.revokeObjectURL(url);c.toBlob(b=>b?resolve(b):reject(new Error('Could not convert this image format.')),'image/jpeg',quality);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not open an image.'));};img.src=url;});return new Uint8Array(await blob.arrayBuffer());
  }
  async function handleFillSignPdf(pdfFile) {
    const doc=await loadPdfLib(pdfFile);const pages=doc.getPages();const total=pages.length;
    await applyAcroFormValues(doc);
    const allItems=state.pageItems.filter(item=>item.type==='signature'||(item.type==='text'&&(item.text||'').trim()));
    const raw=$('repeatOnAllPages')?.checked?'all':(getOption('pageRange','placed')||'placed').trim().toLowerCase();let jobs=[];
    if(raw==='placed')jobs=allItems.map(item=>({page:item.page,item}));
    else {
      const targetPages=parsePageRanges(raw,total);const selected=getSelectedPageItem();const fallbackPage=selected?.page||state.pdfPage;const activeItems=allItems.filter(item=>item.page===fallbackPage);
      if(!activeItems.length&&allItems.length===0&&!Object.entries(state.acroValues||{}).some(([name,value])=>String(value??'')!==String(state.acroFields.find(field=>field.name===name)?.value??'')))throw new Error('Add text, place a signature or fill a PDF form field before downloading.');
      for(const number of targetPages){const own=allItems.filter(item=>item.page===number);const use=own.length?own:activeItems;use.forEach(item=>jobs.push({page:number,item}));}
    }
    const hasFormEdits=Object.entries(state.acroValues||{}).some(([name,value])=>{const original=state.acroFields.find(field=>field.name===name)?.value??'';return String(value??'')!==String(original??'');});
    if(!jobs.length&&!hasFormEdits)throw new Error('Add text, place a signature or change a PDF form field before downloading.');
    const embeddedSignatures=new Map();const embeddedFonts=new Map();
    for(const job of jobs){
      const page=pages[job.page-1];const item=job.item;const pageW=page.getWidth(),pageH=page.getHeight();const x=Math.max(0,Math.min(pageW-1,item.x*pageW));
      if(item.type==='signature'){
        let image=embeddedSignatures.get(item.dataUrl);if(!image){image=await doc.embedPng(dataUrlBytes(item.dataUrl));embeddedSignatures.set(item.dataUrl,image);}
        const width=Math.max(20,Math.min(pageW*.95,item.w*pageW));const height=width*(image.height/image.width);const y=Math.max(0,Math.min(pageH-height,pageH-item.y*pageH-height));page.drawImage(image,{x,y,width,height});
      }else{
        const text=(item.text||'').trim();if(!text)continue;const fontKey=item.fontFamily==='times'?(item.bold?(item.italic?'TimesRomanBoldItalic':'TimesRomanBold'):(item.italic?'TimesRomanItalic':'TimesRoman')):item.fontFamily==='courier'?(item.bold?(item.italic?'CourierBoldOblique':'CourierBold'):(item.italic?'CourierOblique':'Courier')):(item.bold?(item.italic?'HelveticaBoldOblique':'HelveticaBold'):(item.italic?'HelveticaOblique':'Helvetica'));
        let font=embeddedFonts.get(fontKey);if(!font){font=await doc.embedFont(PDFLib.StandardFonts[fontKey]||PDFLib.StandardFonts.Helvetica);embeddedFonts.set(fontKey,font);}
        const size=Math.max(6,Math.min(72,item.fontSize||12));const boxW=Math.max(24,Math.min(pageW-x,item.w*pageW));const boxH=Math.max(size*1.3,Math.min(pageH,item.h*pageH));const y=Math.max(0,Math.min(pageH-boxH,pageH-item.y*pageH-boxH));
        if(item.cover)page.drawRectangle({x,y,width:boxW,height:boxH,color:PDFLib.rgb(1,1,1),borderWidth:0});
        let tx=x+2;const lines=text.slice(0,1500).split(/\r?\n/);if(item.align==='center')tx=x+Math.max(2,(boxW-font.widthOfTextAtSize(lines[0]||'',size))/2);else if(item.align==='right')tx=x+Math.max(2,boxW-font.widthOfTextAtSize(lines[0]||'',size)-3);
        page.drawText(text.slice(0,1500),{x:tx,y:y+Math.max(1,boxH-size-3),size,font,color:hexRgb(item.color||'#111827'),lineHeight:size*1.25,maxWidth:Math.max(20,boxW-5)});
      }
    }
    const bytes=await doc.save({useObjectStreams:true});downloadBytes(bytes,`${stem(pdfFile.name)}-filled-signed.pdf`);
    return `Your complete PDF has been downloaded. ${jobs.length} placed item(s) applied${hasFormEdits?' and changed form fields saved':''}.`;
  }
  async function runSelectedTool() {
    if(state.busy || !state.tool || !state.files.length)return;
    state.busy=true;$('runTool').disabled=true;$('runTool').innerHTML='<span>Processing…</span>';if($('downloadEditedPdf')){$('downloadEditedPdf').disabled=true;$('downloadEditedPdf').textContent='Preparing PDF…';}setStatus('Working locally in your browser. Large documents may take a little time.','busy');
    try {
      let message='Done. Your file has been downloaded.';const t=state.tool;
      if(t==='merge'){
        if(state.files.length<2)throw new Error('Select at least two PDFs to merge.');const out=await PDFLib.PDFDocument.create();
        for(const file of state.files){if(!isPdf(file))throw new Error(`${file.name} is not a PDF.`);const src=await loadPdfLib(file);const copied=await out.copyPages(src,src.getPageIndices());copied.forEach(p=>out.addPage(p));}
        downloadBytes(await out.save({useObjectStreams:true}),`${stem(state.files[0].name)}-merged.pdf`);
      } else if(t==='split'){
        const src=await loadPdfLib(state.files[0]);const total=src.getPageCount();const nums=parsePageRanges(getOption('pageRange','all'),total);if(nums.length>80)throw new Error('Choose up to 80 pages per ZIP to avoid using too much memory.');if(!window.JSZip)throw new Error('ZIP library did not load. Refresh the page and try again.');const zip=new JSZip();
        for(const n of nums){const out=await PDFLib.PDFDocument.create();out.addPage((await out.copyPages(src,[n-1]))[0]);zip.file(`${stem(state.files[0].name)}-page-${n}.pdf`,await out.save({useObjectStreams:true}));}
        downloadBlob(await zip.generateAsync({type:'blob'}),`${stem(state.files[0].name)}-split-pages.zip`);
      } else if(t==='extract'){
        const src=await loadPdfLib(state.files[0]);const nums=parsePageRanges(getOption('pageRange','1-3'),src.getPageCount());const out=await PDFLib.PDFDocument.create();const copied=await out.copyPages(src,nums.map(n=>n-1));copied.forEach(p=>out.addPage(p));downloadBytes(await out.save({useObjectStreams:true}),`${stem(state.files[0].name)}-extracted.pdf`);
      } else if(t==='delete'){
        const src=await loadPdfLib(state.files[0]);const nums=parsePageRanges(getOption('pageRange',''),src.getPageCount());if(nums.length>=src.getPageCount())throw new Error('You cannot delete every page. Leave at least one page.');for(const n of nums.sort((a,b)=>b-a))src.removePage(n-1);downloadBytes(await src.save({useObjectStreams:true}),`${stem(state.files[0].name)}-pages-removed.pdf`);
      } else if(t==='rotate'){
        const src=await loadPdfLib(state.files[0]);const nums=parsePageRanges(getOption('pageRange','all'),src.getPageCount());const angle=Number(getOption('rotateDegrees','90'));for(const n of nums){const page=src.getPage(n-1);page.setRotation(PDFLib.degrees(((page.getRotation().angle+angle)%360+360)%360));}downloadBytes(await src.save({useObjectStreams:true}),`${stem(state.files[0].name)}-rotated.pdf`);
      } else if(t==='images-to-pdf'){
        const out=await PDFLib.PDFDocument.create();const sizeMode=getOption('imagePageSize','fit');
        for(const file of state.files){let image;const bytes=new Uint8Array(await file.arrayBuffer());if(file.type==='image/png'||/\.png$/i.test(file.name)) image=await out.embedPng(bytes);else if(file.type==='image/jpeg'||/\.jpe?g$/i.test(file.name))image=await out.embedJpg(bytes);else image=await out.embedJpg(await imageFileToJpegBytes(file));
          let w=image.width*.75,h=image.height*.75;if(sizeMode==='fit'){const cap=Math.min(1,1100/Math.max(w,h));w*=cap;h*=cap;}else{const pw=sizeMode==='a4'?595.28:612,ph=sizeMode==='a4'?841.89:792;const scale=Math.min(pw/image.width,ph/image.height);w=image.width*scale;h=image.height*scale;const page=out.addPage([pw,ph]);page.drawImage(image,{x:(pw-w)/2,y:(ph-h)/2,width:w,height:h});continue;}const page=out.addPage([w,h]);page.drawImage(image,{x:0,y:0,width:w,height:h});}
        downloadBytes(await out.save({useObjectStreams:true}),`${stem(state.files[0].name)}${state.files.length>1?'-images':''}.pdf`);
      } else if(t==='pdf-to-images'){
        const pdf=await loadPdfJs(state.files[0]);const nums=parsePageRanges(getOption('pageRange','all'),pdf.numPages);if(nums.length>40)throw new Error('Select 40 pages or fewer per export to protect your device memory.');if(!window.JSZip)throw new Error('ZIP library did not load. Refresh and try again.');const zip=new JSZip();const format=getOption('imageFormat','image/jpeg');const ext=format==='image/png'?'png':'jpg';const scale=Number(getOption('renderScale','1.5'));
        for(let i=0;i<nums.length;i++){const n=nums[i];setStatus(`Rendering page ${i+1} of ${nums.length}…`,'busy');const page=await pdf.getPage(n);const vp=page.getViewport({scale});const canvas=document.createElement('canvas');canvas.width=Math.floor(vp.width);canvas.height=Math.floor(vp.height);const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport:vp}).promise;const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not create image.')),format,.92));zip.file(`${stem(state.files[0].name)}-page-${n}.${ext}`,blob);canvas.width=0;canvas.height=0;}
        downloadBlob(await zip.generateAsync({type:'blob'}),`${stem(state.files[0].name)}-images.zip`);
      } else if(t==='sign') {message=await handleFillSignPdf(state.files[0]);}
      else if(t==='watermark'){
        const doc=await loadPdfLib(state.files[0]);const pages=doc.getPages();const nums=parsePageRanges(getOption('pageRange','all'),pages.length);const text=getOption('watermarkText','CONFIDENTIAL').trim();if(!text)throw new Error('Enter watermark text.');const size=Math.max(10,Math.min(100,Number(getOption('watermarkSize','42'))||42));const angle=Number(getOption('watermarkAngle','45'));const font=await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        for(const n of nums){const p=pages[n-1];const width=font.widthOfTextAtSize(text,size);p.drawText(text,{x:Math.max(0,(p.getWidth()-width)/2),y:p.getHeight()*.5,size,font,color:PDFLib.rgb(.73,.74,.79),rotate:PDFLib.degrees(angle)});}downloadBytes(await doc.save({useObjectStreams:true}),`${stem(state.files[0].name)}-watermarked.pdf`);
      } else if(t==='page-numbers'){
        const doc=await loadPdfLib(state.files[0]);const pages=doc.getPages();const start=Math.max(0,Number(getOption('pageNumberStart','1'))||1);const pos=getOption('pageNumberPosition','bottom-center');const fmt=getOption('pageNumberFormat','number');const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        pages.forEach((p,i)=>{const txt=fmt==='page'?`Page ${start+i}`:String(start+i);const size=10,w=font.widthOfTextAtSize(txt,size);let x=(p.getWidth()-w)/2,y=20;if(pos==='bottom-right'){x=p.getWidth()-w-24;}else if(pos==='bottom-left'){x=24;}else if(pos==='top-center'){y=p.getHeight()-24;}p.drawText(txt,{x,y,size,font,color:PDFLib.rgb(.28,.3,.38)});});downloadBytes(await doc.save({useObjectStreams:true}),`${stem(state.files[0].name)}-numbered.pdf`);
      } else if(t==='compress'){
        const original=state.files[0];const doc=await loadPdfLib(original);const bytes=await doc.save({useObjectStreams:true});downloadBytes(bytes,`${stem(original.name)}-optimized.pdf`);const change=bytes.length-original.size;message=change<0?`Basic optimization complete. File size changed by ${humanBytes(Math.abs(change))} smaller.`:change===0?'Basic optimization complete. File size is unchanged.':`Basic optimization complete, but the result is ${humanBytes(change)} larger. This tool does not re-compress embedded images.`;
      }
      setStatus(message,'success');toast('Finished — download started.');
    } catch(err) {setStatus(humanError(err),'error');toast('Could not complete this task. See the message for details.');}
    finally {state.busy=false;$('runTool').disabled=!state.files.length;$('runTool').innerHTML=state.tool==='sign'?'<span>Apply changes &amp; Download</span><span aria-hidden="true">↓</span>':'<span>Process PDF</span><span aria-hidden="true">→</span>';if($('downloadEditedPdf')){$('downloadEditedPdf').disabled=!state.files.length;$('downloadEditedPdf').textContent='Apply changes & Download';}}
  }
  function resetTool() {if(state.tool)selectTool(state.tool);}
  // Tool search and category filters.
  document.querySelectorAll('.tool-card').forEach(btn=>btn.addEventListener('click',()=>selectTool(btn.dataset.tool)));
  document.querySelectorAll('.category-btn').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.category-btn').forEach(b=>b.classList.toggle('is-active',b===btn));filterTools();}));
  $('toolSearch').addEventListener('input',filterTools);
  function filterTools(){const q=$('toolSearch').value.trim().toLowerCase();const cat=document.querySelector('.category-btn.is-active')?.dataset.category||'all';let visible=0;document.querySelectorAll('.tool-card').forEach(card=>{const matchCat=cat==='all'||card.dataset.category===cat;const matchText=card.innerText.toLowerCase().includes(q);card.hidden=!(matchCat&&matchText);if(!card.hidden)visible++;});$('noToolResults').hidden=visible>0;}
  $('fileInput').addEventListener('change',e=>onFilesChanged(e.target.files));
  $('uploadBox').addEventListener('dragover',e=>{e.preventDefault();$('uploadBox').classList.add('is-dragging');});$('uploadBox').addEventListener('dragleave',()=> $('uploadBox').classList.remove('is-dragging'));$('uploadBox').addEventListener('drop',e=>{e.preventDefault();$('uploadBox').classList.remove('is-dragging');if(e.dataTransfer?.files?.length)onFilesChanged(e.dataTransfer.files);});
  $('runTool').addEventListener('click',runSelectedTool);$('resetTool').addEventListener('click',resetTool);$('closeWorkbench').addEventListener('click',()=>{$('workbench').hidden=true;state.tool=null;document.querySelector('#tools').scrollIntoView({behavior:'smooth'});});
  $('prevPage').addEventListener('click',()=>{if(state.pdfPage>1)jumpToPage(state.pdfPage-1);});$('nextPage').addEventListener('click',()=>{if(state.pdfPage<state.pageCount)jumpToPage(state.pdfPage+1);});
  $('pageJumpInput').addEventListener('change',()=>jumpToPage($('pageJumpInput').value));
  $('pageJumpInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();jumpToPage($('pageJumpInput').value);$('pageJumpInput').blur();}});
  $('pdfStageWrap').addEventListener('scroll',()=>{if(state.continuousView)updateCurrentPageFromScroll();},{passive:true});
  window.addEventListener('scroll',()=>{if(state.continuousView)updateCurrentPageFromScroll();},{passive:true});
  document.addEventListener('keydown',event=>{
    if(!state.tool||state.tool!=='sign'||!state.selectedItemId)return;
    if(!['Delete','Backspace'].includes(event.key))return;
    const active=document.activeElement;if(active?.matches('input,textarea,select,[contenteditable="true"]'))return;
    const item=getSelectedPageItem();if(!item)return;event.preventDefault();state.pageItems=state.pageItems.filter(entry=>entry.id!==item.id);state.selectedItemId=null;renderPageItems(item.page);updateEditorItemsStatus();setStatus('Selected item removed.','success');
  });
  setupPlacementEvents(); $('year').textContent=new Date().getFullYear();
  // Inform the visitor if a CDN script failed, rather than leaving silent controls.
  window.addEventListener('load',()=>{if(!window.PDFLib||!window.pdfjsLib||!window.JSZip)setTimeout(()=>{if(!window.PDFLib||!window.pdfjsLib||!window.JSZip){setStatus('Some browser libraries could not load. Check your connection or retry later; Eaziply does not use a paid API.','error');}},1000);});
})();
