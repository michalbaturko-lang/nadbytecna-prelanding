// Presentation only: existing handlers retain authorization, validation and persistence.
(function(global){
 'use strict';
 var $=id=>document.getElementById(id),keySelection=false;
 function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
 function shortDate(value){var d=new Date(value);if(!Number.isFinite(d.getTime()))return '';return d.toDateString()===new Date().toDateString()?d.toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'}):d.toLocaleDateString('cs-CZ',{day:'numeric',month:'numeric'});}
 function row(config,open){
  var a=el('article','story-card client-row'+(config.mail?' mail-card':'')+(config.acute?' is-acute':''));a.dataset.rowId=config.id;
  var top=el('div','client-row-top'),h=el(config.mail?'div':'h2',config.mail?'row-sender':'',config.name),time=el('time','client-date',shortDate(config.at));time.title=config.when||'';top.append(h);
  if(config.media)top.append(el('span','client-media',config.media));
  var flag=config.warning==='Akutní'?'Akutní':config.warning==='Výmaz čeká'?'Výmaz':config.warning==='Zkontrolováno'?'✓':config.warning==='Ke kontrole'||config.status==='Nový'?'•':config.status;
  if(flag)top.append(el('span','client-flag'+(config.warning==='Zkontrolováno'?' checked':''),flag));top.append(time);
  var title=el(config.mail?'h2':'p','client-row-title',config.title),preview=el('p','client-row-preview',String(config.preview||'').replace(/\s+/g,' ').slice(0,200));
  var meta=el('div','client-row-meta');if(config.media)meta.append(el('span','media-label',config.media));if(config.status)meta.append(el('span','row-state',config.status));if(config.warning)meta.append(el('span','row-warning',config.warning));
  open.classList.add('client-row-open');open.setAttribute('aria-label',open.textContent);open.title=[config.name,config.title,config.preview].filter(Boolean).join(' · ');a.append(top,title,preview,meta,open);return a;
 }
 function selected(root,id){root.querySelectorAll('.client-row').forEach(a=>{var active=a.dataset.rowId===id;a.classList.toggle('is-selected',active);var b=a.querySelector('.client-row-open');if(active)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current');});}
 function fold(title,nodes){var d=el('details','reader-group'),s=el('summary','',title);d.append(s);nodes.filter(Boolean).forEach(n=>d.append(n));return d;}
 function state(box){return {open:Array.from(box.querySelectorAll('.reader-group[open]')).map(d=>d.querySelector(':scope > summary')?.textContent),scroll:box.querySelector('.reader-scroll')?.scrollTop||0};}
 function detail(box,kind,previous){
  var original=Array.from(box.children),sections=original.filter(n=>n.classList.contains('section'));
  function find(title){return sections.find(n=>n.querySelector('h3')?.textContent===title);}
  var main=find(kind==='mail'?'Zprávy ve vlákně':'Celá zpráva'),edit=find(kind==='mail'?'Zařazení a další krok':'Další krok'),notes=find(kind==='mail'?'Interní poznámky k e-mailu':'Interní poznámky');
  var oldHead=box.querySelector('.detail-top'),back=oldHead?.querySelector('button'),toolbar=el('div','reader-toolbar');
  if(back){back.classList.add('reader-back');back.title=back.textContent;back.setAttribute('aria-label',back.textContent);toolbar.append(back);}
  var status=box.querySelector(kind==='mail'?'#mail-edit-status':'#edit-status');if(status){var wrap=status.parentElement;wrap.classList.add('toolbar-state');toolbar.append(wrap);}
  var save=edit?.querySelector('.save-bar button');if(save){save.classList.add('reader-save');save.setAttribute('aria-label',save.textContent);save.textContent='Uložit změny';toolbar.append(save);}
  var pdf=oldHead?.querySelector('.story-pdf-download');if(pdf){pdf.classList.add('reader-pdf');pdf.setAttribute('aria-label',pdf.textContent);pdf.title='Stáhnout příběh jako PDF';toolbar.append(pdf);}
  var review=box.querySelector('.mail-human-review button');if(review){review.classList.add('reader-review');review.setAttribute('aria-label',review.textContent);review.title=review.textContent;review.textContent=review.textContent.startsWith('Vrátit')?'Zkontrolováno':'Zkontrolovat';toolbar.append(review);}
  var firstOriginal=main&&Array.from(main.querySelectorAll('button')).find(b=>b.textContent==='Stáhnout originál .eml');if(firstOriginal){firstOriginal.setAttribute('aria-label',firstOriginal.textContent);firstOriginal.textContent='Originál .eml';firstOriginal.classList.add('reader-original');toolbar.append(firstOriginal);}
  var scroll=el('div','reader-scroll'),inner=el('div','reader-inner'),heading=el('div','reader-heading');
  var headerNodes=original.filter(n=>n.tagName==='H2'||n.classList.contains('tag-row')||n.classList.contains('meta')||n.classList.contains('mail-sender')||n.classList.contains('crisis'));
  headerNodes.forEach(n=>heading.append(n));inner.append(heading);if(main){main.classList.add('reader-content');inner.append(main);}
  var used=new Set([oldHead,main,edit,notes,...headerNodes]);
  if(notes){inner.append(fold('Interní poznámky',[notes]));used.add(notes);}
  if(edit){inner.append(fold('Zařazení a další krok',[edit]));used.add(edit);}
  var contact=find('Kontakt'),consent=find('Souhlasy a věk');if(contact||consent){inner.append(fold('Kontakt a souhlasy',[contact,consent]));used.add(contact);used.add(consent);}
  var ai=original.filter(n=>n.classList.contains('ai-block')||n.classList.contains('mail-ai-scope')||(!used.has(n)&&!n.classList.contains('section')&&!n.classList.contains('mail-human-review')));
  if(ai.length){inner.append(fold('AI analýza',ai));ai.forEach(n=>used.add(n));}
  var human=original.find(n=>n.classList.contains('mail-human-review'));if(human){var remaining=human.querySelector('p');if(remaining)inner.append(el('p','review-timestamp mail-human-review',remaining.textContent));used.add(human);}
  sections.filter(n=>!used.has(n)).forEach(n=>{inner.append(fold(n.querySelector('h3')?.textContent||'Další údaje',[n]));used.add(n);});
  if(kind==='mail'&&main){Array.from(main.querySelectorAll('.mail-message')).forEach((a,i)=>{if(i>0){var d=el('details','previous-message'),summary=el('summary','',a.querySelector('.meta')?.textContent||a.querySelector('h3')?.textContent||'Předchozí zpráva');a.before(d);d.append(summary,a);}});}
  scroll.append(inner);box.replaceChildren(toolbar,scroll);if(previous){box.querySelectorAll('.reader-group').forEach(d=>{d.open=previous.open.includes(d.querySelector(':scope > summary')?.textContent);});scroll.scrollTop=previous.scroll;}
 }
 document.addEventListener('keydown',function(event){
  if(event.key==='Escape'&&!document.querySelector('dialog[open]')){document.querySelectorAll('.workspace-actions details[open],#mail-filters[open]').forEach(d=>{d.open=false;d.querySelector('summary')?.focus();});}
  var target=event.target&&event.target.nodeType===1?event.target:document.body;
  if(target.closest('input,textarea,select')||document.querySelector('dialog[open]'))return;
  var focused=target.closest('.client-row-open');
  if(focused&&innerWidth>=1024&&['ArrowUp','ArrowDown'].includes(event.key)){
   var root=focused.closest('#admin-cards,#mail-cards'),buttons=Array.from(root.querySelectorAll('.client-row-open')),i=buttons.indexOf(focused),next=buttons[i+(event.key==='ArrowDown'?1:-1)];if(next){event.preventDefault();next.focus();keySelection=true;next.click();}
  }
 });
 document.addEventListener('click',function(event){var target=event.target&&event.target.nodeType===1?event.target:null;if(target?.closest('button')){var overview=target.closest('.workspace-actions details.overview');if(overview)overview.open=false;}});
 document.addEventListener('pointerdown',function(event){document.querySelectorAll('.workspace-actions details[open],#mail-filters[open]').forEach(d=>{if(!d.contains(event.target))d.open=false;});});
 global.NadbytecnaAdminLayout={row,selected,detail,state,keyboard:()=>{var value=keySelection;keySelection=false;return value;}};
})(window);
