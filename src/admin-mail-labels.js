// Local mailbox labels only. API callbacks retain the existing admin authorization.
(function (global) {
  "use strict";
  function el(tag, text, cls) { var n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n; }
  function catalog(status) { return Array.isArray(status?.labelCatalog) ? status.labelCatalog : []; }
  function name(code,status) { return catalog(status).find(x=>x.code===code)?.name || code; }
  function labels(row) { return Array.isArray(row.labels) ? row.labels : []; }
  function badges(row,status,limit) {
    var list=labels(row),box=el('div',null,'mail-rule-labels');
    list.slice(0,limit||list.length).forEach(function(label){var badge=el('span',name(label.code,status),'mail-rule-label');badge.title=(label.source==='manual'?'Ručně':'Pravidlo')+(label.reason?' · '+label.reason:'');box.append(badge);});
    if(limit&&list.length>limit)box.append(el('span','+'+(list.length-limit),'mail-rule-more'));
    if(row.disposition==='suspect')box.append(el('span','Podezřelé','mail-rule-label suspect'));
    else if(row.disposition==='review')box.append(el('span','Ověřit','mail-rule-label review'));
    return box;
  }
  function editor(row,status,change,onError) {
    var section=el('section',null,'section');section.id='mail-labels-section';section.append(el('h3','Štítky a třídění'));
    var busy=false;
    async function run(patch) {
      if(busy)return;busy=true;section.querySelectorAll('button,select').forEach(n=>n.disabled=true);
      try {await change(patch);}catch(error){onError(error);}finally{busy=false;section.querySelectorAll('button,select').forEach(n=>n.disabled=false);}
    }
    function action(text,patch){var b=el('button',text);b.type='button';b.addEventListener('click',()=>run(typeof patch==='function'?patch():patch));return b;}
    section.append(el('p',row.disposition==='suspect'?'Vlákno je v Podezřelých. Zprávy i originály zůstávají uložené.':row.disposition==='review'?'Pravidla doporučují ověření člověkem. Vlákno zůstává v běžné poště.':'Štítky a třídění platí pro kopii v adminu.','hint'));
    labels(row).forEach(function(label){
      var item=el('div',null,'mail-label-edit-row'),info=el('div');info.append(el('span',name(label.code,status),'mail-label-name'),el('small',label.source==='manual'?'Ručně':'Pravidlo'));
      if(label.reason)info.append(el('p',label.reason,'hint'));
      var remove=action('Odebrat',{remove:[label.code]});remove.setAttribute('aria-label','Odebrat štítek '+name(label.code,status));item.append(info,remove);section.append(item);
    });
    if(catalog(status).length){
      var label=el('label','Přidat štítek');label.htmlFor='mail-add-label';var select=el('select');select.id='mail-add-label';select.append(new Option('Vyberte štítek',''));
      catalog(status).filter(x=>!labels(row).some(l=>l.code===x.code)).forEach(x=>select.append(new Option(x.name,x.code)));
      var add=action('Přidat štítek',()=>({add:select.value?[select.value]:[]}));add.disabled=true;select.addEventListener('change',()=>{add.disabled=!select.value;});var form=el('div',null,'mail-label-add');form.append(select,add);section.append(label,form);
    }
    var actions=el('div',null,'actions');
    actions.append(row.disposition==='suspect'?action('Vrátit do pošty',{disposition:'normal',remove:['spam','suspected_fraud']}):action('Označit jako podezřelé',{disposition:'suspect',add:['spam']}));
    if(row.disposition_source==='manual')actions.append(action('Vrátit automatické třídění',{disposition:'auto'}));
    section.append(actions);return section;
  }
  global.NadbytecnaMailLabels={catalog,name,badges,editor};
})(window);
