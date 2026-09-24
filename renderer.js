// Renderer logic for PDF Studio. Loaded as an ES module from index.html so the page can run
// under a strict Content-Security-Policy (no inline or remote scripts).
import * as pdfjsLib from './node_modules/pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './node_modules/pdfjs-dist/build/pdf.worker.mjs';

// ── App ───────────────────────────────────────────────────────────────────────
function initApp() {
  const IS_ELECTRON = typeof window.pdfStudio !== 'undefined';
  const $ = id => document.getElementById(id);

  const S = {
    doc:null, bytes:null, page:1, pages:0,
    scale:1.3, tool:'select',
    drawing:false, path:[], dragStart:null,
    annots:{}, color:'#E85A4A',
    brush:4, opacity:40,
    filename:'', filesize:0, pageW:0, pageH:0,
  };

  const pc = $('pc'), ac = $('ac');
  const ctx = pc.getContext('2d'), actx = ac.getContext('2d');
  const cvbox = $('cvbox'), dz = $('dz'), ld = $('ld');
  const pi = $('pi'), ptotal = $('ptotal'), zlbl = $('zlbl');
  const sidebar = $('sidebar'), rp = $('rp');
  const cinp = $('cinp'), csw = $('csw');
  const thumbs = $('thumbs'), toast = $('toast');

  // ── Palette ───────────────────────────────────────────────────────────────
  const PALETTE = ['#E85A4A','#F5A623','#F8E04A','#4CAF50',
                   '#4A82EE','#9B59B6','#EC4899','#000000','#FFFFFF'];
  const palEl = $('pal');
  PALETTE.forEach(c => {
    const d = document.createElement('div');
    d.className = 'pc' + (c===S.color?' sel':'');
    d.style.background = c;
    d.onclick = () => { palEl.querySelectorAll('.pc').forEach(x=>x.classList.remove('sel')); d.classList.add('sel'); setColor(c); };
    palEl.appendChild(d);
  });

  function setColor(c) {
    S.color = c;
    csw.style.background = c;
    cinp.value = c;
  }
  setColor(S.color);
  csw.onclick = () => cinp.click();
  cinp.oninput = e => { setColor(e.target.value); palEl.querySelectorAll('.pc').forEach(x=>x.classList.remove('sel')); };

  // ── Tools ─────────────────────────────────────────────────────────────────
  const CURSORS = {select:'default',draw:'crosshair',highlight:'crosshair',text:'text',shape:'crosshair',erase:'cell'};
  const NAMES   = {select:'Select',draw:'Draw',highlight:'Highlight',text:'Add Text',shape:'Shape',erase:'Erase'};

  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));

  function setTool(t) {
    S.tool = t;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool===t));
    ac.style.cursor = CURSORS[t]||'default';
    $('st-tool').textContent = NAMES[t]||t;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag==='INPUT'||tag==='TEXTAREA') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey||e.metaKey)&&k==='o') { e.preventDefault(); openFile(); }
    if ((e.ctrlKey||e.metaKey)&&k==='s') { e.preventDefault(); saveFile(); }
    if (e.ctrlKey||e.metaKey||e.altKey) return;
    if (k==='v') setTool('select');
    if (k==='d') setTool('draw');
    if (k==='h') setTool('highlight');
    if (k==='t') setTool('text');
    if (k==='s') setTool('shape');
    if (k==='e') setTool('erase');
    if (k==='arrowleft'||k===',') prevPage();
    if (k==='arrowright'||k==='.') nextPage();
    if (k==='+'||k==='=') zoomIn();
    if (k==='-') zoomOut();
    if (k==='w') fitWidth();
  });

  // ── File open ─────────────────────────────────────────────────────────────
  function openFile() {
    if (IS_ELECTRON) window.pdfStudio.requestOpen();
    else $('fi').click();
  }

  $('open-btn').onclick = openFile;
  $('dz-open').onclick  = openFile;
  $('fi').onchange = e => { if (e.target.files[0]) loadFileObj(e.target.files[0]); };

  // Electron: receive file from main process
  if (IS_ELECTRON) {
    window.pdfStudio.onOpenFile(payload => {
      const bytes = new Uint8Array(payload.data);
      loadBytes(bytes, payload.name, payload.size);
    });
    window.pdfStudio.onDoSave(() => exportPDF());
    window.pdfStudio.ready();
  }

  async function loadFileObj(file) {
    const arr = await file.arrayBuffer();
    loadBytes(new Uint8Array(arr), file.name, file.size);
  }

  async function loadBytes(bytes, name, size) {
    S.bytes = bytes;
    S.filename = name; S.filesize = size; S.annots = {};
    showToast('Loading…');
    try {
      S.doc = await pdfjsLib.getDocument({data: bytes.slice(), isEvalSupported: false}).promise;
    } catch(err) { showToast('Cannot read PDF — ' + err.message); return; }
    S.pages = S.doc.numPages;
    S.page  = 1;
    ptotal.textContent = '/ ' + S.pages;
    pi.max  = S.pages;
    dz.hidden   = true;
    cvbox.hidden = false;
    $('sdot').style.background = '#3DB87A';
    $('st-file').textContent = name;
    $('inf-file').textContent  = name;
    $('inf-pages').textContent = S.pages;
    $('inf-size').textContent  = fmtSz(size);
    if (IS_ELECTRON) window.pdfStudio.setTitle(name);
    // Open fitted to the window width (large drawings would otherwise show only a corner)
    const vp1 = (await S.doc.getPage(1)).getViewport({scale:1});
    S.scale = +Math.min(1.5, ($('cvwrap').clientWidth-48)/vp1.width).toFixed(2);
    await renderPage(1);
    buildThumbs();
    showToast('Loaded — ' + S.pages + (S.pages===1?' page':' pages'));
  }

  function fmtSz(b) {
    if (b<1024) return b+' B';
    if (b<1048576) return (b/1024).toFixed(1)+' KB';
    return (b/1048576).toFixed(1)+' MB';
  }

  // ── Page render ───────────────────────────────────────────────────────────
  async function renderPage(num) {
    if (!S.doc||num<1||num>S.pages) return;
    S.page = num; pi.value = num;
    ld.hidden = false;
    const pg = await S.doc.getPage(num);
    const vp = pg.getViewport({scale:S.scale});
    S.pageW = Math.round(vp.width);
    S.pageH = Math.round(vp.height);
    // Page canvas renders at device resolution so it stays sharp on scaled displays
    const dpr = window.devicePixelRatio || 1;
    pc.width=Math.round(vp.width*dpr); pc.height=Math.round(vp.height*dpr);
    ac.width=S.pageW; ac.height=S.pageH;
    pc.style.width=S.pageW+'px'; pc.style.height=S.pageH+'px';
    ac.style.width=S.pageW+'px'; ac.style.height=S.pageH+'px';
    actx.setTransform(S.scale,0,0,S.scale,0,0);
    await pg.render({canvasContext:ctx, viewport:pg.getViewport({scale:S.scale*dpr})}).promise;
    ld.hidden=true;
    drawAnnotations(num);
    updateStatus(); updateThumbActive();
    $('inf-page').textContent = num+' / '+S.pages;
    $('inf-w').textContent    = Math.round(vp.width)+'px';
    $('inf-h').textContent    = Math.round(vp.height)+'px';
    $('inf-an').textContent   = (S.annots[num]||[]).length;
    if ($('tab-text').classList.contains('on')) extractText(num);
  }

  function updateStatus() {
    $('st-page').textContent = 'Page '+S.page+' of '+S.pages;
    $('st-zoom').textContent = Math.round(S.scale*100)+'%';
    zlbl.textContent = Math.round(S.scale*100)+'%';
  }

  // ── Thumbnails ────────────────────────────────────────────────────────────
  async function buildThumbs() {
    thumbs.innerHTML='';
    for (let i=1; i<=S.pages; i++) {
      const wrap = document.createElement('div');
      wrap.className = 'thumb'+(i===S.page?' cur':'');
      wrap.dataset.p = i;
      wrap.onclick = () => renderPage(i);
      const tc = document.createElement('canvas');
      wrap.appendChild(tc);
      const n = document.createElement('div');
      n.className='thumb-n'; n.textContent=i;
      wrap.appendChild(n);
      thumbs.appendChild(wrap);
      const pg = await S.doc.getPage(i);
      const vp = pg.getViewport({scale:0.18});
      tc.width=Math.round(vp.width); tc.height=Math.round(vp.height);
      pg.render({canvasContext:tc.getContext('2d'),viewport:vp});
    }
  }

  function updateThumbActive() {
    thumbs.querySelectorAll('.thumb').forEach(t=>t.classList.toggle('cur',+t.dataset.p===S.page));
    const cur=thumbs.querySelector('.cur');
    if(cur) cur.scrollIntoView({block:'nearest'});
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  $('prev-btn').onclick=prevPage; $('next-btn').onclick=nextPage;
  function prevPage(){if(S.page>1)renderPage(S.page-1);}
  function nextPage(){if(S.page<S.pages)renderPage(S.page+1);}
  pi.onchange=()=>{const n=+pi.value; if(n>=1&&n<=S.pages)renderPage(n); else pi.value=S.page;};

  // ── Zoom ──────────────────────────────────────────────────────────────────
  $('zoom-in').onclick=zoomIn; $('zoom-out').onclick=zoomOut; $('zoom-fit').onclick=fitWidth;
  function zoomIn(){S.scale=Math.min(S.scale+0.25,4); renderPage(S.page);}
  function zoomOut(){S.scale=Math.max(S.scale-0.25,0.4); renderPage(S.page);}
  function fitWidth(){
    const w=$('cvwrap').clientWidth-48;
    S.doc?.getPage(S.page).then(pg=>{
      const b=pg.getViewport({scale:1});
      S.scale=+(w/b.width).toFixed(2);
      renderPage(S.page);
    });
  }

  // ── Drag-drop ─────────────────────────────────────────────────────────────
  ['dragover','dragenter'].forEach(ev=>
    document.addEventListener(ev,e=>{e.preventDefault();$('dz-area').classList.add('drag');}));
  document.addEventListener('dragleave',()=>$('dz-area').classList.remove('drag'));
  document.addEventListener('drop',e=>{
    e.preventDefault(); $('dz-area').classList.remove('drag');
    const f=e.dataTransfer.files[0]; if(f)loadFileObj(f);
  });

  // ── Annotation canvas ─────────────────────────────────────────────────────
  function getPos(e) {
    const r=ac.getBoundingClientRect(), src=e.touches?e.touches[0]:e;
    return {x:(src.clientX-r.left)/S.scale, y:(src.clientY-r.top)/S.scale};
  }

  ac.addEventListener('mousedown',startDraw);
  ac.addEventListener('mousemove',moveDraw);
  ac.addEventListener('mouseup',endDraw);
  ac.addEventListener('touchstart',e=>{e.preventDefault();startDraw(e);},{passive:false});
  ac.addEventListener('touchmove', e=>{e.preventDefault();moveDraw(e); },{passive:false});
  ac.addEventListener('touchend',  e=>{e.preventDefault();endDraw(e);  },{passive:false});

  function startDraw(e) {
    if(!S.doc) return;
    const {x,y}=getPos(e);
    S.drawing=true; S.dragStart={x,y};
    if(S.tool==='draw') S.path=[{x,y}];
    // preventDefault: the mousedown's default focus change would instantly blur (and discard) the new text box
    else if(S.tool==='text'){e.preventDefault(); S.drawing=false; placeText(x,y);}
  }

  function moveDraw(e) {
    if(!S.drawing) return;
    const {x,y}=getPos(e);
    if(S.tool==='draw'){
      S.path.push({x,y}); redrawLayer();
      actx.beginPath(); actx.strokeStyle=S.color; actx.lineWidth=S.brush/S.scale;
      actx.lineCap='round'; actx.lineJoin='round';
      const p=S.path;
      if(p.length>1){actx.moveTo(p[p.length-2].x,p[p.length-2].y); actx.lineTo(p[p.length-1].x,p[p.length-1].y); actx.stroke();}
    } else if(S.tool==='highlight'||S.tool==='shape'){
      redrawLayer();
      const {x:x0,y:y0}=S.dragStart, w=x-x0, h=y-y0;
      if(S.tool==='highlight'){actx.globalAlpha=S.opacity/100; actx.fillStyle=S.color; actx.fillRect(x0,y0,w,h); actx.globalAlpha=1;}
      else{actx.strokeStyle=S.color; actx.lineWidth=S.brush/S.scale; actx.strokeRect(x0,y0,w,h);}
    } else if(S.tool==='erase'){
      eraseAt(x,y);
    }
  }

  function endDraw(e) {
    if(!S.drawing) return;
    S.drawing=false;
    const end = e.changedTouches
      ? getPos({clientX:e.changedTouches[0].clientX,clientY:e.changedTouches[0].clientY})
      : getPos(e);
    if(!S.annots[S.page]) S.annots[S.page]=[];
    const an=S.annots[S.page];
    if(S.tool==='draw'&&S.path.length>1)
      an.push({type:'draw',path:[...S.path],color:S.color,size:S.brush/S.scale});
    else if(S.tool==='highlight'){
      const{x:x0,y:y0}=S.dragStart;
      if(Math.abs(end.x-x0)>3&&Math.abs(end.y-y0)>3)
        an.push({type:'highlight',rect:[x0,y0,end.x-x0,end.y-y0],color:S.color,opacity:S.opacity});
    } else if(S.tool==='shape'){
      const{x:x0,y:y0}=S.dragStart;
      if(Math.abs(end.x-x0)>3&&Math.abs(end.y-y0)>3)
        an.push({type:'shape',rect:[x0,y0,end.x-x0,end.y-y0],color:S.color,size:S.brush/S.scale});
    }
    S.path=[];
    drawAnnotations(S.page);
    $('inf-an').textContent=an.length;
  }

  function eraseAt(x,y){
    const an=S.annots[S.page]; if(!an)return;
    const r=S.brush*8/S.scale;
    S.annots[S.page]=an.filter(a=>{
      if(a.type==='highlight'||a.type==='shape'){const[rx,ry,rw,rh]=a.rect;return!(x>=rx&&x<=rx+rw&&y>=ry&&y<=ry+rh);}
      if(a.type==='draw') return !a.path.some(p=>Math.hypot(p.x-x,p.y-y)<r);
      if(a.type==='text') return !(Math.abs(a.x-x)<80/S.scale&&Math.abs(a.y-y)<24/S.scale);
      return true;
    });
    redrawLayer();
  }

  function placeText(x,y){
    const old=cvbox.querySelector('.ta'); if(old)commitText(old);
    const ta=document.createElement('textarea');
    ta.className='ta';
    ta.style.left=x*S.scale+'px'; ta.style.top=y*S.scale+'px';
    ta.style.color=S.color; ta.style.fontSize=(S.brush*3+10)+'px';
    ta.rows=1; cvbox.appendChild(ta); ta.focus();
    ta.oninput=()=>{ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';};
    ta.onblur=()=>commitText(ta);
    ta.onkeydown=e=>{if(e.key==='Escape')ta.remove();if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ta.blur();}};
  }

  function commitText(ta){
    const txt=ta.value.trim();
    if(txt){
      if(!S.annots[S.page])S.annots[S.page]=[];
      S.annots[S.page].push({type:'text',text:txt,x:parseFloat(ta.style.left)/S.scale,y:parseFloat(ta.style.top)/S.scale,color:S.color,size:(S.brush*3+10)/S.scale});
      drawAnnotations(S.page);
      $('inf-an').textContent=S.annots[S.page].length;
    }
    ta.remove();
  }

  // ── Draw layer ────────────────────────────────────────────────────────────
  function redrawLayer(){
    actx.clearRect(0,0,ac.width/S.scale,ac.height/S.scale);
    (S.annots[S.page]||[]).forEach(a=>drawAnnot(a));
  }

  function drawAnnotations(pn){
    actx.clearRect(0,0,ac.width/S.scale,ac.height/S.scale);
    (S.annots[pn]||[]).forEach(a=>drawAnnot(a));
  }

  function drawAnnot(a){
    actx.save();
    if(a.type==='draw'){
      actx.beginPath(); actx.strokeStyle=a.color; actx.lineWidth=a.size;
      actx.lineCap='round'; actx.lineJoin='round';
      a.path.forEach((p,i)=>i===0?actx.moveTo(p.x,p.y):actx.lineTo(p.x,p.y));
      actx.stroke();
    } else if(a.type==='highlight'){
      actx.globalAlpha=(a.opacity||40)/100; actx.fillStyle=a.color; actx.fillRect(...a.rect);
    } else if(a.type==='shape'){
      actx.strokeStyle=a.color; actx.lineWidth=a.size; actx.strokeRect(...a.rect);
    } else if(a.type==='text'){
      actx.font=`${a.size}px -apple-system,system-ui,sans-serif`;
      actx.fillStyle=a.color; actx.fillText(a.text,a.x,a.y+a.size);
    }
    actx.restore();
  }

  // ── Clear ─────────────────────────────────────────────────────────────────
  $('clear-page').onclick=()=>{S.annots[S.page]=[];drawAnnotations(S.page);$('inf-an').textContent=0;showToast('Page cleared');};
  $('clear-all').onclick=()=>{S.annots={};drawAnnotations(S.page);$('inf-an').textContent=0;showToast('All cleared');};

  // ── Text extraction ───────────────────────────────────────────────────────
  async function extractText(num){
    if(!S.doc)return;
    $('txt-pg').textContent=num;
    $('txt-rd').textContent='Extracting…';
    try{
      const pg=await S.doc.getPage(num);
      const tc=await pg.getTextContent();
      $('txt-rd').textContent=tc.items.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim()||'(No selectable text on this page)';
    }catch{$('txt-rd').textContent='Could not extract text.';}
  }

  // ── Panel tabs ────────────────────────────────────────────────────────────
  document.querySelectorAll('.rp-tab').forEach(tab=>tab.onclick=()=>{
    document.querySelectorAll('.rp-tab').forEach(t=>t.classList.toggle('on',t.dataset.tab===tab.dataset.tab));
    document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('on',p.id==='tab-'+tab.dataset.tab));
    rp.classList.remove('off');
    if(tab.dataset.tab==='text'&&S.doc) extractText(S.page);
  });

  $('toggle-panel').onclick=()=>rp.classList.toggle('off');
  $('toggle-sb').onclick=()=>sidebar.classList.toggle('off');

  // ── Brush / opacity ───────────────────────────────────────────────────────
  $('bsldr').oninput=()=>{S.brush=+$('bsldr').value;$('bval').textContent=S.brush;};
  $('opsldr').oninput=()=>{S.opacity=+$('opsldr').value;$('opval').textContent=S.opacity+'%';};

  // ── Save / Export ─────────────────────────────────────────────────────────
  $('save-btn').onclick=saveFile;
  $('exp-btn').onclick=saveFile;

  function saveFile(){
    if(!S.doc){showToast('No PDF open');return;}
    if(IS_ELECTRON) window.pdfStudio.requestSave();
    else exportPDFBrowser();
  }

  async function exportPDF(){
    showToast('Exporting…');
    try{
      const bytes = await buildAnnotatedPDF();
      window.pdfStudio.writePDF(bytes);
    }catch(err){showToast('Export failed: '+err.message);}
  }

  async function exportPDFBrowser(){
    showToast('Preparing…');
    try{
      const bytes=await buildAnnotatedPDF();
      const blob=new Blob([bytes],{type:'application/pdf'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url; a.download=S.filename.replace('.pdf','-annotated.pdf');
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),5000);
      showToast('Downloaded!');
    }catch(err){showToast('Export failed: '+err.message);}
  }

  async function buildAnnotatedPDF(){
    const{PDFDocument,rgb,StandardFonts,degrees}=PDFLib;
    const pdfDoc=await PDFDocument.load(S.bytes.buffer);
    const font=await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages=pdfDoc.getPages();
    for(const[pn,ans]of Object.entries(S.annots)){
      const pg=pages[+pn-1]; if(!pg||!ans.length)continue;
      const vp=(await S.doc.getPage(+pn)).getViewport({scale:1});
      const P=(x,y)=>{const[px,py]=vp.convertToPdfPoint(x,y);return{x:px,y:py};};
      const box=([rx,ry,rw,rh])=>{const a=P(rx,ry),b=P(rx+rw,ry+rh);
        return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};};
      for(const a of ans){
        const c=h2r(a.color), color=rgb(c.r,c.g,c.b);
        if(a.type==='highlight'){
          pg.drawRectangle({...box(a.rect),color,opacity:(a.opacity||40)/100});
        }else if(a.type==='shape'){
          pg.drawRectangle({...box(a.rect),borderColor:color,borderWidth:a.size,opacity:0});
        }else if(a.type==='text'){
          pg.drawText(a.text,{...P(a.x,a.y+a.size),size:a.size,font,color,rotate:degrees(vp.rotation)});
        }else if(a.type==='draw'){
          for(let i=1;i<a.path.length;i++)
            pg.drawLine({start:P(a.path[i-1].x,a.path[i-1].y),end:P(a.path[i].x,a.path[i].y),thickness:a.size,color});
        }
      }
    }
    return await pdfDoc.save();
  }

  function h2r(hex){
    return{r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255};
  }

  // ── Toast ─────────────────────────────────────────────────────────────────
  let toastT;
  function showToast(msg){
    toast.textContent=msg; toast.classList.add('show');
    clearTimeout(toastT); toastT=setTimeout(()=>toast.classList.remove('show'),2800);
  }

  // ── Hide drag bar on non-macOS ─────────────────────────────────────────────
  if(!IS_ELECTRON || navigator.platform.toLowerCase().includes('win'))
    $('drag-bar').style.display='none';

  setTool('select');
}

initApp();
