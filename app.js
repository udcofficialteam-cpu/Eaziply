/* PDFNest: browser-side PDF tools. No upload API, backend, account or paid API key. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  if (window.pdfjsLib) { pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'; }
  const state = {
    tool: null, files: [], previewDoc: null, previewFile: null, pdfPage: 1, pageCount: 0, viewScale: 1, previewPageWidth: 600,
    position: { x: 0.43, y: 0.62 }, positionSet: false, signatureImageFile: null,
    signatureDrawn: false, signaturePadReady: false, busy: false
  };
  const TOOL = {
    merge: { title:'Merge PDF', description:'Combine two or more PDFs into one document, in the order you select them.', accept:'.pdf,application/pdf', multiple:true, category:'organize' },
    split: { title:'Split PDF', description:'Create one PDF per selected page and download the pages together as a ZIP.', accept:'.pdf,application/pdf', category:'organize' },
    extract: { title:'Extract pages', description:'Copy selected pages into one new PDF, leaving the original unchanged.', accept:'.pdf,application/pdf', category:'organize' },
    delete: { title:'Delete pages', description:'Remove page numbers you choose and download the remaining document.', accept:'.pdf,application/pdf', category:'organize' },
    rotate: { title:'Rotate PDF', description:'Rotate all pages or only the page numbers you choose.', accept:'.pdf,application/pdf', category:'organize' },
    'images-to-pdf': { title:'JPG / images to PDF', description:'Turn selected images into a single PDF document.', accept:'image/*', multiple:true, category:'convert' },
    'pdf-to-images': { title:'PDF to JPG / PNG', description:'Render selected PDF pages as images and download them in a ZIP.', accept:'.pdf,application/pdf', category:'convert' },
    sign: { title:'Sign PDF', description:'Type, draw or upload a signature, click the page to place it, then download the signed PDF.', accept:'.pdf,application/pdf', category:'sign' },
    'add-text': { title:'Fill & add text', description:'Place names, addresses, dates or other text anywhere on a PDF page.', accept:'.pdf,application/pdf', category:'sign' },
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
      case 'sign': return `<div class="option-field"><label for="signatureMode">Signature method</label><select id="signatureMode"><option value="typed">Type a name</option><option value="draw">Draw with mouse or touch</option><option value="upload">Upload signature image</option></select></div><div id="typedSignatureFields"><div class="option-field"><label for="signatureName">Name / signature text</label><input id="signatureName" value="Your Name" maxlength="90" placeholder="Type your name"></div><div class="option-row"><div class="option-field"><label for="signatureStyle">Signature style</label><select id="signatureStyle"><option value="brush">Brush script</option><option value="elegant">Elegant cursive</option><option value="classic">Classic italic</option><option value="modern">Modern italic</option><option value="hand">Handwritten</option><option value="bold">Bold cursive</option></select></div><div class="option-field"><label for="signatureColor">Ink color</label><input id="signatureColor" type="color" value="#17213f" style="width:100%;height:40px;border:1px solid #dfe2ed;border-radius:10px;background:#fff;padding:4px"></div></div></div><div id="drawSignatureFields" hidden><div class="option-field"><label>Draw your signature below</label><div class="signature-pad-wrap"><canvas class="signature-pad" id="signaturePad" width="640" height="180" aria-label="Draw signature here"></canvas><div class="pad-actions"><button class="small-button" id="clearSignaturePad" type="button">Clear drawing</button></div></div></div></div><div id="uploadSignatureFields" hidden><div class="option-field"><label for="signatureUpload">Signature image (PNG preferred)</label><input id="signatureUpload" type="file" accept="image/png,image/jpeg,image/webp"><span class="option-hint">Transparent PNG usually gives the cleanest result.</span></div></div><div class="option-field"><label for="signatureWidth">Signature width (PDF points)</label><input id="signatureWidth" type="number" min="35" max="400" value="150"></div><div class="option-field"><label for="pageRange">Apply to page(s)</label><input id="pageRange" value="1" placeholder="e.g. 1, 3-5 or all"><span class="option-hint">Navigate the preview pages on the right, click where the signature should go, or drag the signature preview to adjust its position.</span></div><div class="note-box">This creates a visible signature mark. It is not a certificate-based digital signature or identity verification.</div>`;
      case 'add-text': return `<div class="option-field"><label for="textToAdd">Text to place</label><textarea id="textToAdd" maxlength="1500" placeholder="Type a name, address, date or other information"></textarea></div><div class="option-row"><div class="option-field"><label for="textFontSize">Font size (pt)</label><input id="textFontSize" type="number" min="6" max="72" value="12"></div><div class="option-field"><label for="textColor">Text color</label><input id="textColor" type="color" value="#111827" style="width:100%;height:40px;border:1px solid #dfe2ed;border-radius:10px;background:#fff;padding:4px"></div></div><div class="option-field"><label for="pageRange">Apply to page(s)</label><input id="pageRange" value="1" placeholder="e.g. 1, 3-5 or all"><span class="option-hint">Click the preview page to choose where the text starts.</span></div>`;
      case 'watermark': return `<div class="option-field"><label for="watermarkText">Watermark text</label><input id="watermarkText" value="CONFIDENTIAL" maxlength="100"></div><div class="option-row"><div class="option-field"><label for="watermarkSize">Font size (pt)</label><input id="watermarkSize" type="number" min="10" max="100" value="42"></div><div class="option-field"><label for="watermarkAngle">Angle</label><select id="watermarkAngle"><option value="45">45° diagonal</option><option value="0">Horizontal</option><option value="-45">-45° diagonal</option></select></div></div><div class="option-field"><label for="pageRange">Apply to page(s)</label><input id="pageRange" value="all" placeholder="all or 1, 3-5"></div>`;
      case 'page-numbers': return `<div class="option-row"><div class="option-field"><label for="pageNumberStart">Start numbering at</label><input id="pageNumberStart" type="number" min="0" max="999999" value="1"></div><div class="option-field"><label for="pageNumberPosition">Position</label><select id="pageNumberPosition"><option value="bottom-center">Bottom centre</option><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="top-center">Top centre</option></select></div></div><div class="option-field"><label for="pageNumberFormat">Number format</label><select id="pageNumberFormat"><option value="number">1, 2, 3…</option><option value="page">Page 1, Page 2…</option></select></div>`;
      case 'compress': return `<div class="note-box">Basic optimization rewrites the PDF with object streams. It does not resize embedded photos or remove all redundant content, so the result may not be smaller. This tool does not rasterize pages, helping preserve selectable text and vector content.</div>`;
      default: return '';
    }
  }
  function selectTool(tool) {
    if (!TOOL[tool]) return;
    state.tool=tool; state.files=[]; state.previewDoc=null; state.previewFile=null; state.pdfPage=1; state.pageCount=0; state.position={x:.43,y:.62}; state.positionSet=false; state.signatureImageFile=null; state.signatureDrawn=false;
    const def=TOOL[tool]; $('workbenchTitle').textContent=def.title; $('workbenchDescription').textContent=def.description;
    $('fileInput').value=''; $('fileInput').accept=def.accept; $('fileInput').multiple=!!def.multiple;
    $('uploadTitle').textContent=def.multiple?'Choose files':'Choose a file';
    $('uploadHint').textContent=tool==='images-to-pdf'?'JPG, PNG and supported browser image formats':(tool==='merge'?'Select two or more PDF files':'PDF file · select from your device');
    $('selectedFiles').hidden=true; $('selectedFiles').innerHTML=''; $('runTool').disabled=true;
    $('toolOptions').innerHTML=optionsHtml(tool);
    $('previewEmpty').hidden=false; $('pdfStageWrap').hidden=true; $('pageControls').hidden=true; $('previewHelp').hidden=!['sign','add-text'].includes(tool); $('previewMeta').textContent='Your PDF preview will appear here'; $('placementOverlay').hidden=true;
    $('workbench').hidden=false; $('workbench').scrollIntoView({behavior:'smooth',block:'start'});
    const signMode=$('signatureMode'); if(signMode){ signMode.addEventListener('change',updateSignatureMode); updateSignatureMode(); setupSignaturePad(); $('signatureName').addEventListener('input',updatePlacementOverlay); $('signatureStyle').addEventListener('change',updatePlacementOverlay); $('signatureColor').addEventListener('input',updatePlacementOverlay); $('signatureWidth').addEventListener('input',updatePlacementOverlay); }
    if($('textToAdd')){ $('textToAdd').addEventListener('input',updatePlacementOverlay); $('textFontSize').addEventListener('input',updatePlacementOverlay); $('textColor').addEventListener('input',updatePlacementOverlay); }
    if($('signatureUpload')) $('signatureUpload').addEventListener('change',e=>{ state.signatureImageFile=e.target.files[0]||null; updatePlacementOverlay(); });
    $('closeWorkbench').focus({preventScroll:true}); setStatus('Choose your file(s) to begin.');
  }
  function updateSignatureMode() {
    const mode=$('signatureMode')?.value||'typed';
    $('typedSignatureFields').hidden=mode!=='typed'; $('drawSignatureFields').hidden=mode!=='draw'; $('uploadSignatureFields').hidden=mode!=='upload';
    updatePlacementOverlay();
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
  function fileListText() {
    const wrap=$('selectedFiles');wrap.innerHTML='';
    state.files.forEach((file,index)=>{const row=document.createElement('div');row.className='file-chip';const icon=document.createElement('span');icon.textContent='▣';const name=document.createElement('span');name.textContent=file.name;const size=document.createElement('span');size.textContent=humanBytes(file.size);row.append(icon,name,size); if(['merge','images-to-pdf'].includes(state.tool)){const controls=document.createElement('span');controls.className='file-order-controls';const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='Move up';up.disabled=index===0;up.addEventListener('click',()=>{if(index>0){[state.files[index-1],state.files[index]]=[state.files[index],state.files[index-1]];fileListText();}});const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='Move down';down.disabled=index===state.files.length-1;down.addEventListener('click',()=>{if(index<state.files.length-1){[state.files[index+1],state.files[index]]=[state.files[index],state.files[index+1]];fileListText();}});controls.append(up,down);row.appendChild(controls);} wrap.appendChild(row);});
    wrap.hidden=!state.files.length;
  }
  async function onFilesChanged(files) {
    state.files=Array.from(files||[]); state.previewDoc=null;state.previewFile=null;state.pdfPage=1;state.pageCount=0;state.signatureImageFile=null;state.position={x:.43,y:.62};state.positionSet=false;
    fileListText();
    if(state.files.some(f=>f.size>80*1024*1024)){setStatus('Each file must be 80 MB or smaller for this browser-based version.','error');$('runTool').disabled=true;return;}
    if(state.files.reduce((sum,f)=>sum+f.size,0)>150*1024*1024){setStatus('This selection is over 150 MB total. Process fewer or smaller files to avoid running out of browser memory.','error');$('runTool').disabled=true;return;}
    if(!state.files.length){$('runTool').disabled=true;return;}
    if(state.tool==='merge' && state.files.length<2){setStatus('Select at least two PDF files to merge.','error');$('runTool').disabled=true;return;}
    if(!['images-to-pdf'].includes(state.tool) && state.files.some(f=>!isPdf(f))){setStatus('This tool needs PDF files. Please select a PDF.','error');$('runTool').disabled=true;return;}
    if(state.tool==='images-to-pdf' && state.files.some(f=>!f.type.startsWith('image/'))){setStatus('Please select image files only.','error');$('runTool').disabled=true;return;}
    $('runTool').disabled=false;
    const totalBytes=state.files.reduce((sum,f)=>sum+f.size,0);
    setStatus(`${state.files.length} file(s) selected · ${humanBytes(totalBytes)} total.`);
    if(state.files[0] && isPdf(state.files[0])) {
      try {
        setStatus('Loading PDF preview…','busy');
        state.previewFile=state.files[0]; state.previewDoc=await loadPdfJs(state.previewFile); state.pageCount=state.previewDoc.numPages;
        $('pageControls').hidden=false; updatePageControls(); await renderCurrentPage();
        $('previewMeta').textContent=`${state.pageCount} page(s) · ${humanBytes(state.previewFile.size)}`;
        setStatus(`${state.files.length} file(s) selected. PDF preview is ready.`,'success');
      } catch(err) {
        $('previewEmpty').hidden=false;$('pdfStageWrap').hidden=true;$('pageControls').hidden=true;
        setStatus(`File selected, but preview failed: ${humanError(err)}`,'error');
      }
    } else {
      $('previewEmpty').hidden=false;$('pdfStageWrap').hidden=true;$('pageControls').hidden=true;
      $('previewEmpty').querySelector('strong').textContent='Image files selected';
      $('previewEmpty').querySelector('span:last-child').textContent='The selected images will be placed into a PDF in the order shown on the left.';
      $('previewMeta').textContent=`${state.files.length} image(s) · ${humanBytes(totalBytes)}`;
      setStatus(`${state.files.length} image(s) ready to combine into PDF.`,'success');
    }
    updatePlacementOverlay();
  }
  function updatePageControls() { $('pageIndicator').textContent=`${state.pdfPage} / ${state.pageCount||1}`; $('prevPage').disabled=state.pdfPage<=1; $('nextPage').disabled=state.pdfPage>=state.pageCount; }
  async function renderCurrentPage() {
    if(!state.previewDoc) return;
    const page=await state.previewDoc.getPage(state.pdfPage);
    const base=page.getViewport({scale:1}); const maxWidth=Math.max(260,Math.min(720,($('previewColumn')?.clientWidth||780)-65));
    const scale=Math.min(maxWidth/base.width,1.4); state.viewScale=scale; state.previewPageWidth=base.width; const viewport=page.getViewport({scale});
    const canvas=$('pdfCanvas');canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);canvas.style.width=`${Math.floor(viewport.width)}px`;canvas.style.height=`${Math.floor(viewport.height)}px`;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,viewport}).promise;
    $('previewEmpty').hidden=true;$('pdfStageWrap').hidden=false;$('pdfStage').style.width=`${canvas.width}px`;$('pdfStage').style.height=`${canvas.height}px`;
    updatePageControls();updatePlacementOverlay();
  }
  function getOption(id, fallback='') { const el=$(id);return el?el.value:fallback; }
  function updatePlacementOverlay() {
    const overlay=$('placementOverlay'); if(!overlay || !state.tool || !['sign','add-text'].includes(state.tool) || !state.previewDoc || $('pdfStageWrap').hidden){if(overlay)overlay.hidden=true;return;}
    overlay.hidden=false;overlay.style.left=`${Math.max(0,Math.min(.95,state.position.x))*100}%`;overlay.style.top=`${Math.max(0,Math.min(.95,state.position.y))*100}%`;overlay.style.transform='translate(0, 0)';overlay.style.width='auto';overlay.style.height='auto';overlay.style.background='rgba(255,255,255,.42)';overlay.style.border='1px dashed rgba(101,85,232,.65)';overlay.replaceChildren();overlay.classList.remove('is-image');
    const viewScale=state.viewScale||1;
    const styleFor=key=>({brush:'italic "Brush Script MT", "Segoe Script", cursive',elegant:'italic "Segoe Print", "Comic Sans MS", cursive',classic:'italic Georgia, serif',modern:'italic "Trebuchet MS", sans-serif',hand:'"Comic Sans MS", cursive',bold:'bold italic "Segoe Script", cursive'}[key]||'cursive');
    if(state.tool==='sign') {
      const mode=getOption('signatureMode','typed');
      if(mode==='typed') { const name=getOption('signatureName','Your Name').trim()||'Your Name'; overlay.textContent=name; const fs=Math.max(10,Number(getOption('signatureWidth','150'))*.22*viewScale); overlay.style.fontFamily=styleFor(getOption('signatureStyle','brush')); overlay.style.fontStyle='italic';overlay.style.fontSize=`${fs}px`;overlay.style.color=getOption('signatureColor','#17213f'); }
      else if(mode==='draw') {const c=$('signaturePad');if(c && state.signatureDrawn){const img=document.createElement('img');img.src=c.toDataURL('image/png');img.alt='Signature preview';img.style.width=`${Math.min(340,Number(getOption('signatureWidth','150'))*viewScale)}px`;img.style.height='auto';overlay.appendChild(img);overlay.classList.add('is-image');}else{overlay.textContent='Draw signature first';overlay.style.fontSize='13px';overlay.style.color='#8a90a4';}}
      else if(mode==='upload') { const f=state.signatureImageFile;if(f){const img=document.createElement('img');img.src=URL.createObjectURL(f);img.alt='Uploaded signature preview';img.style.width=`${Math.min(340,Number(getOption('signatureWidth','150'))*viewScale)}px`;img.style.height='auto';overlay.appendChild(img);overlay.classList.add('is-image');}else{overlay.textContent='Upload signature first';overlay.style.fontSize='12px';overlay.style.color='#8a90a4';}}
    } else {
      const text=getOption('textToAdd','')||'Your text';overlay.textContent=text.split('\n')[0];overlay.style.whiteSpace='pre';overlay.style.fontFamily='Arial, sans-serif';overlay.style.fontStyle='normal';overlay.style.fontSize=`${Math.max(8,Number(getOption('textFontSize','12'))*viewScale)}px`;overlay.style.color=getOption('textColor','#111827');
    }
  }
  function setupPlacementEvents() {
    $('pdfCanvas').addEventListener('click',e=>{
      if(!state.tool||!['sign','add-text'].includes(state.tool)||!state.previewDoc)return;
      const r=$('pdfCanvas').getBoundingClientRect();state.position={x:Math.max(0,Math.min(.94,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(.94,(e.clientY-r.top)/r.height))};state.positionSet=true;updatePlacementOverlay();
      setStatus(`Placement set on preview page ${state.pdfPage}. Drag the preview item to adjust it.`,'success');
    });
    const overlay=$('placementOverlay');let drag=null;
    overlay.addEventListener('pointerdown',e=>{if(overlay.hidden||!state.tool||!['sign','add-text'].includes(state.tool))return;drag={x:e.clientX,y:e.clientY,px:state.position.x,py:state.position.y};overlay.setPointerCapture(e.pointerId);e.preventDefault();});
    overlay.addEventListener('pointermove',e=>{if(!drag)return;const r=$('pdfCanvas').getBoundingClientRect();state.position.x=Math.max(0,Math.min(.92,drag.px+(e.clientX-drag.x)/r.width));state.position.y=Math.max(0,Math.min(.92,drag.py+(e.clientY-drag.y)/r.height));updatePlacementOverlay();});
    const stop=()=>{drag=null;};overlay.addEventListener('pointerup',stop);overlay.addEventListener('pointercancel',stop);
  }
  function humanError(err) {
    const msg=String(err?.message||err||'Unknown error');
    if(/encrypted|password/i.test(msg)) return 'This PDF may be password-protected. Password-protected PDFs are not supported in this version.';
    if(/worker|fetch|network|load/i.test(msg)) return 'A browser library or PDF could not load. Check your internet connection and try again.';
    return msg.length>240?msg.slice(0,237)+'…':msg;
  }
  function hexRgb(hex) { const v=(hex||'#111827').replace('#','');const n=parseInt(v.length===3?v.split('').map(c=>c+c).join(''):v,16);return PDFLib.rgb(((n>>16)&255)/255,((n>>8)&255)/255,(n&255)/255); }
  async function getSignaturePng() {
    const mode=getOption('signatureMode','typed');
    if(mode==='draw') {
      const pad=$('signaturePad');if(!state.signatureDrawn)throw new Error('Draw your signature in the signature box first.');
      const c=document.createElement('canvas');c.width=pad.width;c.height=pad.height;const ctx=c.getContext('2d');ctx.drawImage(pad,0,0);return new Uint8Array(await (await fetch(c.toDataURL('image/png'))).arrayBuffer());
    }
    if(mode==='upload') {
      const file=state.signatureImageFile;if(!file)throw new Error('Choose a signature image first.');return await imageFileToPngBytes(file);
    }
    const text=getOption('signatureName','').trim();if(!text)throw new Error('Enter your name for the signature.');
    const style=getOption('signatureStyle','brush');const color=getOption('signatureColor','#17213f');
    const styles={brush:'italic 86px "Brush Script MT", "Segoe Script", cursive',elegant:'italic 82px "Segoe Print", "Comic Sans MS", cursive',classic:'italic 78px Georgia, serif',modern:'italic 76px "Trebuchet MS", sans-serif',hand:'76px "Comic Sans MS", cursive',bold:'bold italic 76px "Segoe Script", cursive'};
    const canvas=document.createElement('canvas');canvas.width=1400;canvas.height=190;let ctx=canvas.getContext('2d');ctx.font=styles[style]||styles.brush;const measure=ctx.measureText(text);canvas.width=Math.max(300,Math.min(1400,Math.ceil(measure.width+55)));ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.font=styles[style]||styles.brush;ctx.fillStyle=color;ctx.textBaseline='middle';ctx.fillText(text,20,98,canvas.width-40);return new Uint8Array(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer());
  }
  async function imageFileToPngBytes(file) {
    if(file.type==='image/png')return new Uint8Array(await file.arrayBuffer());
    const blob=await new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url);c.toBlob(b=>b?resolve(b):reject(new Error('Could not convert signature image.')),'image/png');};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not open the signature image.'));};img.src=url;});return new Uint8Array(await blob.arrayBuffer());
  }
  async function imageFileToJpegBytes(file, quality=.92) {
    if(file.type==='image/jpeg') return new Uint8Array(await file.arrayBuffer());
    const blob=await new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0);URL.revokeObjectURL(url);c.toBlob(b=>b?resolve(b):reject(new Error('Could not convert this image format.')),'image/jpeg',quality);};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not open an image.'));};img.src=url;});return new Uint8Array(await blob.arrayBuffer());
  }
  async function handleSignOrText(pdfFile, tool) {
    const doc=await loadPdfLib(pdfFile);const pages=doc.getPages();const selected=parsePageRanges(getOption('pageRange',tool==='sign'?'1':'1'),pages.length);const sourcePages=tool==='sign'?selected:selected;
    const xPct=state.position.x, yPct=state.position.y;
    if(tool==='sign'){
      const pngBytes=await getSignaturePng();const img=await doc.embedPng(pngBytes);const firstPage=pages[Math.max(0,(state.pdfPage||1)-1)];const w=Math.min(400,Math.max(35,Number(getOption('signatureWidth','150'))||150));const h=w*(img.height/img.width);
      for(const one of sourcePages){const p=pages[one-1];const drawW=Math.min(w,p.getWidth()*.9);const drawH=drawW*(img.height/img.width);const x=Math.max(0,Math.min(p.getWidth()-drawW,xPct*p.getWidth()));const top=Math.max(0,Math.min(p.getHeight()-drawH,yPct*p.getHeight()));p.drawImage(img,{x,y:p.getHeight()-top-drawH,width:drawW,height:drawH});}
    } else {
      const text=getOption('textToAdd','').trim();if(!text)throw new Error('Enter the text to add.');const size=Math.max(6,Math.min(72,Number(getOption('textFontSize','12'))||12));const color=hexRgb(getOption('textColor','#111827'));const font=await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      for(const one of selected){const p=pages[one-1];const lines=text.split(/\r?\n/).slice(0,20);const x=Math.max(0,Math.min(p.getWidth()-20,xPct*p.getWidth()));const y=Math.max(0,Math.min(p.getHeight()-size,(1-yPct)*p.getHeight()-size));p.drawText(lines.join('\n'),{x,y,size,font,color,lineHeight:size*1.25,maxWidth:Math.max(30,p.getWidth()-x-12)});}
    }
    const bytes=await doc.save({useObjectStreams:true});downloadBytes(bytes,`${stem(pdfFile.name)}-${tool==='sign'?'signed':'filled'}.pdf`);return tool==='sign'?'Signature added and PDF downloaded.':'Text added and PDF downloaded.';
  }
  async function runSelectedTool() {
    if(state.busy || !state.tool || !state.files.length)return;
    state.busy=true;$('runTool').disabled=true;$('runTool').innerHTML='<span>Processing…</span>';setStatus('Working locally in your browser. Large documents may take a little time.','busy');
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
      } else if(t==='sign'||t==='add-text') {message=await handleSignOrText(state.files[0],t);}
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
    finally {state.busy=false;$('runTool').disabled=!state.files.length;$('runTool').innerHTML='<span>Process PDF</span><span aria-hidden="true">→</span>';}
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
  $('prevPage').addEventListener('click',async()=>{if(state.pdfPage>1){state.pdfPage--;await renderCurrentPage();}});$('nextPage').addEventListener('click',async()=>{if(state.pdfPage<state.pageCount){state.pdfPage++;await renderCurrentPage();}});
  setupPlacementEvents(); $('year').textContent=new Date().getFullYear();
  // Inform the visitor if a CDN script failed, rather than leaving silent controls.
  window.addEventListener('load',()=>{if(!window.PDFLib||!window.pdfjsLib||!window.JSZip)setTimeout(()=>{if(!window.PDFLib||!window.pdfjsLib||!window.JSZip){setStatus('Some browser libraries could not load. Check your connection or retry later; PDFNest does not use a paid API.','error');}},1000);});
})();
