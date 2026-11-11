const $=id=>document.getElementById(id);
const overlayMode=new URLSearchParams(location.search).get('overlay')==='1';
if(overlayMode)document.documentElement.dataset.overlay='true';
let state=null,busy=false,refreshAgain=false,noteKey='',liveState=null;
const currentPlayer=()=>($('slot').value==='latest'&&liveState?.player)||state?.player;
const currentArea=()=>($('slot').value==='latest'&&liveState?.connected&&liveState.area)||state?.area||'';
const currentQuests=()=>($('slot').value==='latest'&&liveState?.connected?liveState.quests:null)||state?.quests||{};
const names={Item_Hookshot:T('Grappin'),Item_Longshot:T('Super grappin'),Weapon_Sword_Master:T('Épée de Légende'),Weapon_Sword_Kokiri:T('Épée Kokiri'),Weapon_Range_Bow:T('Arc des fées'),Weapon_Range_SlingShot:T('Lance-pierre'),Item_Ocarina_Time:T('Ocarina du Temps'),Item_Ocarina_Fairy:T('Ocarina des fées'),Item_Medal_Forest:T('Médaillon de la Forêt'),Item_Medal_Fire:T('Médaillon du Feu'),Item_Medal_Water:T('Médaillon de l’Eau'),Item_Medal_Shadow:T('Médaillon de l’Ombre'),Item_Medal_Spirit:T('Médaillon de l’Esprit'),Item_Medal_Light:T('Médaillon de la Lumière'),Item_Token_Gold:T('Skulltulas d’or'),Item_Hammer:T('Masse des Titans'),Item_Boomerang:'Boomerang',Item_DinFire:T('Feu de Din'),Item_FaroreWind:T('Vent de Farore'),Item_NayruLove:T('Amour de Nayru')};
const songs={FireBolero:T('Boléro du Feu'),SpiritRequiem:T('Requiem des Esprits'),SariaSong:T('Chant de Saria'),StormSong:T('Chant des Tempêtes'),WaterSerenade:T('Sérénade de l’Eau'),ZeldaLullaby:T('Berceuse de Zelda'),ForestMinuet:T('Menuet des Bois'),ShadowNocturne:T('Nocturne de l’Ombre')};
const areas={SacredForestMeadow:T('Bosquet sacré'),KokiriForest:T('Forêt Kokiri'),ForestTemple:T('Temple de la Forêt'),LostWoods:T('Bois perdus'),HyruleField:T('Plaine d’Hyrule'),LonLonRanch:T('Ranch Lon Lon'),KakarikoVillage:T('Village Cocorico'),Graveyard:T('Cimetière'),TimeTemple:T('Temple du Temps'),LakeHylia:T('Lac Hylia')};
function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
function card(label,detail,active){const box=node('div','','item'+(active?'':' absent'));box.append(itemIcon(label)||node('span',active?'✦':'◇','icon'));const t=node('div','');t.append(node('strong',label),node('small',detail));box.append(t);return box;}
function renderItems(){if(!state)return;const q=$('search').value.toLocaleLowerCase();const filter=$('filter').value;const items=state.inventory.filter(i=>(names[i.id]||i.label).toLocaleLowerCase().includes(q)&& (filter==='all'||(filter==='owned'?i.count>0:i.count===0)));$('items').replaceChildren(...items.map(i=>card(names[i.id]||i.label,i.count>0?T('Possédé · ')+i.count:T('Absent de cet inventaire'),i.count>0)));if(!items.length)$('items').append(node('p',T('Aucun objet trouvé.'),'muted'));}
Object.assign(areas,{BottomOfTheWell:T('Fond du puits'),DeathMountainCrater:T('Cratère du Péril'),DeathMountainTrail:T('Mont du Péril'),DesertColossus:T('Colosse du désert'),GerudoFortress:T('Forteresse Gerudo'),GerudoValley:T('Vallée Gerudo'),GoronCity:T('Village Goron'),ZoraDomain:T('Domaine Zora'),ZoraFountain:T('Fontaine Zora'),ZoraRiver:T('Rivière Zora'),Market:T('Place du marché'),FireTemple:T('Temple du Feu'),WaterTemple:T('Temple de l’Eau'),ShadowTemple:T('Temple de l’Ombre'),SpiritTemple:T('Temple de l’Esprit'),InsideTheDekuTree:T('Arbre Mojo'),InsideJabuJabuBelly:T('Ventre de Jabu-Jabu'),IceCavern:T('Caverne polaire'),HyruleCastle:T('Château d’Hyrule')});
let catalog=[],plans=[],kind='all',selected=null,scale=1,ox=0,oy=0,drag=null;
let preferredEra=null,alignSaveOnRefresh=true,mapSyncNotice='',mapMode='region';
function alignMapWithSave({preserveZoom=true}={}){
 const previous=preserveZoom&&mapMode==='region'?{region:$('region').value,plan:$('plan').value,scale,ox,oy}:null;
 const area=currentArea(),match=area.match(/_(Child|Adult)(?:_|$)/);
 preferredEra=match?match[1]:null;
 const exactPlan=planForPlayer()||plans.find(p=>p.id.split('/')[6]===area);
 const base=area.replace(/_(?:Child|Adult)(?:_.*)?$/,'');
 const aliases={LostWoods:'LostWood',HauntedWasteland:'HountedWasteland'};
 const candidate=exactPlan?.id.split('/')[5]||catalog.find(x=>x.bank===area)?.map||aliases[base]||base;
 const choices=plans.filter(p=>p.id.split('/')[5]===candidate);
 if(!choices.length){mapSyncNotice=T('Zone sauvegardée : ')+regionName(base)+T(' · Aucun plan disponible pour cette zone.');draw();return;}
 selected=null;$('detail').classList.remove('has-selection');
 $('detail').replaceChildren(node('p',T('Sélectionne un repère pour consulter son état.'),'muted'));
 setRegion(candidate);
 if(exactPlan){$('plan').value=exactPlan.id;fit();syncPickers();}
 const eraPlans=choices.filter(p=>/_(Child|Adult)(?:_|$)/.test(p.id.split('/')[6]));
 if(preferredEra&&eraPlans.length&&!eraPlans.some(p=>p.id.split('/')[6].includes('_'+preferredEra))){
  mapSyncNotice=T('Zone sauvegardée : ')+regionName(candidate)+' · '+(preferredEra==='Adult'?T('Adulte'):T('Enfant'))+T('. Plan de cette époque indisponible ; ')+planLabel({id:$('plan').value}).toLowerCase()+T(' affiché.');
 }
 if(previous&&Boolean(plans.find(p=>p.id===previous.plan)?.interior)===Boolean(plans.find(p=>p.id===$('plan').value)?.interior)){
  scale=previous.scale;
  if(previous.plan===$('plan').value){ox=previous.ox;oy=previous.oy;}
  else{const b=bounds(),r=$('map').getBoundingClientRect();if(b){ox=r.width/2-(b.minX+b.maxX)*scale/2;oy=r.height/2-(b.minY+b.maxY)*scale/2;}}
 }
 draw();
}

Object.assign(areas,{LostWood:T('Bois perdus'),HountedWasteland:T('Désert hanté'),GanonCastle:T('Château de Ganon'),DodongoCavern:T('Caverne Dodongo'),GerudoTrainingGround:T('Gymnase Gerudo'),InsideGanonCastle:T('Intérieur du château de Ganon')});
const regionName=x=>areas[x]||x.replace(/([a-z])([A-Z])/g,'$1 $2');
const title=x=>x.guide?.title||(x.kind==='skull'?T('Skulltula d’or'):T('Fragment de cœur'));
const status=x=>x.owned===true?T('Obtenu'):x.owned===false?T('À trouver'):T('À vérifier');
const symbol=x=>x.owned===true?'✓':x.owned===null?'?':x.kind==='heart'?'♥':'◆';
const planLabel=p=>{
 if(p.label)return (p.id.includes('_Adult/')?T('Adulte'):p.id.includes('_Child/')?T('Enfant'):T('Toutes époques'))+' · '+p.label;
 const bits=p.id.split('/'),layer=bits.at(-1),floor=layer.match(/^(B\d+|\d+F)(?:_|$)/)?.[1];
 if(floor){const water=layer.match(/Lv([123])/),variant=layer.match(/State(\d+)/);return floor+(water?' · '+T({1:'Eau basse',2:'Eau moyenne',3:'Eau haute'}[water[1]]):'')+(variant&&Number(variant[1])?T(' · Variante ')+(Number(variant[1])+1):'');}
 return (bits.at(-2).includes('Adult')?T('Adulte'):bits.at(-2).includes('Child')?T('Enfant'):T('Toutes époques'))+' · '+(p.kind==='dungeon'?T('Vue générale'):layer.replace(/^00$/,T('Extérieur')));
};
function planForPlayer(){
 const player=currentPlayer();if(!player||player.area!==currentArea())return null;
 const bank=player.area.replace(/_Alternative$/,''),choices=plans.filter(p=>p.id.split('/')[6].replace(/_Alternative$/,'')===bank);
 const current=choices.find(p=>p.id===$('plan').value);
 if(player.floor){
  if(current?.floor===player.floor)return current;
  const variants=choices.filter(p=>p.floor===player.floor),suffix=current?.id.split('/').at(-1).replace(/^(B\d+|\d+F)/,'');
  return variants.find(p=>suffix&&p.id.endsWith('/'+player.floor+suffix))||variants.find(p=>p.id===player.plan)||variants[0]||null;
 }
 return choices.find(p=>p.id===player.plan)||null;
}
function collectibleOnPlan(item,plan){
 if(plan.interior)return item.plan===plan.id;
 if(item.guide&&!plan.floor&&item.map===plan.id.split('/')[5])return true;
 if(item.plan===plan.id)return true;
 const original=plans.find(p=>p.id===item.plan);
 return !!(plan.floor&&original?.floor===plan.floor&&original.id.split('/')[6]===plan.id.split('/')[6]);
}

function matchesSelectedEra(x){
 const bank=$('plan').value.split('/')[6]||'';
 const era=bank.match(/_(Child|Adult)(?:_|$)/)?.[1]?.toLowerCase();
 if(!era)return true;
 if(x.guide)return x.ages.includes('both')||x.ages.includes(era);
 const itemEra=(x.bank||'').match(/_(Child|Adult)(?:_|$)/)?.[1]?.toLowerCase();
 if(itemEra)return itemEra===era;
 return !x.ages?.length||x.ages.includes('both')||x.ages.includes(era);
}
function currentSkulltulas(){
 return $('slot').value==='latest'&&liveState?.connected&&Number.isInteger(liveState.skulltulas)?liveState.skulltulas:state?.skulltulas;
}
function overlayCollectibleVisible(item,tokens){
 if(item.owned!==false)return false;
 return !(item.requirements||[]).some(r=>r.condition==='tokens50'&&!(tokens>=50));
}
function applyCollectibleState(){
 const owned=new Map((state?.collectibles?.items||[]).map(x=>[x.id,x.owned]));
 if($('slot').value==='latest'&&liveState?.connected){
  for(const x of liveState.collectibles?.items||[])if(typeof x.owned==='boolean')owned.set(x.id,x.owned);
 }
 let changed=false;
 for(const x of catalog){const value=owned.get(x.id)??null;if(x.owned!==value)changed=true;x.owned=value;}
 return changed;
}
function filtered(){const q=$('map-search').value.toLocaleLowerCase(),f=$('status-filter').value;return catalog.filter(x=>(!overlayMode||overlayCollectibleVisible(x,currentSkulltulas()))&&matchesSelectedEra(x)&&(kind==='all'||x.kind===kind)&&(!q||[regionName(x.map),x.guide?.region,title(x),x.kind==='heart'?T('fragment de cœur'):'',x.guide?.location,...(x.guide?.steps||[])].join(' ').toLocaleLowerCase().includes(q))&&(!$('local-only').checked||x.map===$('region').value)&&(f==='all'||f==='missing'&&x.owned===false||f==='owned'&&x.owned===true||f==='unknown'&&x.owned==null));}
function renderList(){const rows=filtered();$('result-count').textContent=rows.length+(rows.length>1?T(' repères'):T(' repère'));$('results').replaceChildren(...rows.map(x=>{const b=node('button','','result');b.setAttribute('aria-pressed',String(selected===x.id));b.append(collectibleIcon(x,'token '+x.kind));const t=node('span','');t.append(node('strong',title(x)+(x.guide?'':' · '+String(catalog.filter(i=>i.map===x.map&&i.kind===x.kind).findIndex(i=>i.id===x.id)+1).padStart(2,'0'))),node('small',(x.guide?.region||regionName(x.map))+' · '+status(x)));b.append(t);b.onclick=()=>selectItem(x);return b;}));if(!rows.length)$('results').append(node('p',T('Aucun repère pour ces filtres.'),'panel-foot'));draw();}
function setRegion(id){mapMode='region';syncMapMode();mapSyncNotice='';$('region').value=id;const choices=plans.filter(p=>p.id.split('/')[5]===id).sort((a,b)=>(a.heightRange?.[0]??0)-(b.heightRange?.[0]??0)||a.id.localeCompare(b.id,undefined,{numeric:true}));$('plan').replaceChildren(...choices.map(p=>new Option(planLabel(p),p.id)));const preferred=choices.find(p=>preferredEra&&p.id.split('/')[6].includes('_'+preferredEra));if(preferred)$('plan').value=preferred.id;fit();renderList();syncPickers();}
function selectItem(x){
 if(!overlayMode)pauseFollowing();selected=x.id;if($('region').value!==x.map)setRegion(x.map);
 const choices=plans.filter(p=>p.id.split('/')[5]===x.map);
 const current=choices.find(p=>p.id===$('plan').value);
 const era=x.guide?.era;
 const matching=x.guide&&choices.find(p=>era==='both'||p.id.includes('_'+(era==='child'?'Child':'Adult')));
 $('plan').value=x.guide&&current&&matchesSelectedEra(x)?current.id:matching?.id||x.plan;
 syncPickers();fit();renderList();showDetail(x);$('carte').classList.remove('show-list');$('mobile-list').textContent=T('Liste des repères');
}
function showDetail(x){
 const d=$('detail'),scroll=d.scrollTop,same=d.dataset.selection===x.id;
 d.dataset.selection=x.id;d.classList.add('has-selection');
 d.replaceChildren(node('p',x.guide?T('FRAGMENT DE CŒUR'):T('CARNET D’EXPLORATION'),'eyebrow'),collectibleIcon(x,'detail-emblem collectible-emblem'),node('h2',title(x)),node('p',x.guide?.region||regionName(x.map),'muted'),node('span',status(x),'status'));
 if(x.guide){
  const g=x.guide,section=node('section','','heart-guide');
  section.append(node('h3',T('Où le trouver')),node('p',g.location,'heart-location'),node('h3',T('Comment le récupérer')));
  const steps=node('ol','');g.steps.forEach(text=>steps.append(node('li',text)));section.append(steps);
  d.append(section);addRequirements(x);
 }
 const technical=node('details','','detail-map-info');technical.append(node('summary',T('Repère sur la carte')));
 const dl=node('dl','');
 for(const [k,v]of [[T('Époque'),x.guide?{child:T('Parcours enfant'),adult:T('Parcours adulte'),both:T('Enfant ou adulte')}[x.guide.era]:planLabel({id:x.plan})],[T('Coordonnées'),x.position.map(v=>v.toFixed(1)).join(' / ')]]){const row=node('div','');row.append(node('dt',k),node('dd',v));dl.append(row);}
 const mapLink=node('a',T('Ouvrir Owl Object Map ↗'));mapLink.href=x.source;mapLink.target='_blank';mapLink.rel='noopener';technical.append(dl,mapLink);d.append(technical);
 if(!x.guide)addRequirements(x);
 if(x.guide?.source){const a=node('a',T('Guide : ')+x.guide.source.label+' ↗','guide-source');a.href=x.guide.source.url;a.target='_blank';a.rel='noopener';d.append(a);}
 if(x.owned==null)d.append(node('p',T('La sauvegarde ne permet pas encore de confirmer la collecte de ce repère.'),'notice'));
 const close=node('button',T('Fermer la fiche'),'close-detail');close.onclick=()=>{selected=null;d.classList.remove('has-selection');d.replaceChildren(node('p',T('Sélectionne un repère pour consulter son état.'),'muted'));renderList();};d.append(close);
 d.scrollTop=same?scroll:0;
}
function bounds(){if(mapMode==='world')return {minX:0,minY:0,maxX:1366,maxY:993};const p=plans.find(p=>p.id===$('plan').value);if(!p)return null;const pts=catalog.filter(x=>collectibleOnPlan(x,p)),b=p.bounds,pad=p.padding??15;return {p,minX:Math.min(...(b?[b.x[0]]:[]),...p.layers.map(l=>l.left),...pts.map(x=>x.position[0]))-pad,minY:Math.min(...(b?[b.z[0]]:[]),...p.layers.map(l=>l.top),...pts.map(x=>x.position[2]))-pad,maxX:Math.max(...(b?[b.x[1]]:[]),...p.layers.map(l=>l.left+l.width),...pts.map(x=>x.position[0]))+pad,maxY:Math.max(...(b?[b.z[1]]:[]),...p.layers.map(l=>l.top+l.height),...pts.map(x=>x.position[2]))+pad};}
let needsFit=false;
function fit(){const b=bounds();if(!b)return;const r=$('map').getBoundingClientRect();if(!r.width||!r.height){needsFit=true;return;}needsFit=false;scale=Math.min(r.width/(b.maxX-b.minX),r.height/(b.maxY-b.minY))*.98;ox=(r.width-(b.maxX+b.minX)*scale)/2;oy=(r.height-(b.maxY+b.minY)*scale)/2;draw();}
function pan(){if(mapMode==='world'){draw();return;}const w=$('world'),p=plans.find(p=>p.id===$('plan').value);for(const n of w.children)if(n._w){n.style.left=ox+n._w[0]*scale+'px';n.style.top=oy+n._w[1]*scale+'px';}if(p){w.querySelector('.player-marker')?.remove();drawPlayerMarker(w,p);}}
function draw(){if(mapMode==='world'){drawWorldOverview();return;}const p=plans.find(p=>p.id===$('plan').value);if(!p)return;const w=$('world');w.replaceChildren();for(const l of p.layers){const im=document.createElement('img');im.src='/maps/'+l.file;im.alt=p.interior?p.label+T(' · Plan intérieur'): '';im.draggable=false;im._w=[l.left,l.top];im.style.cssText=`left:${ox+l.left*scale}px;top:${oy+l.top*scale}px;width:${l.width*scale}px;height:${l.height*scale}px`;w.append(im);}const rows=filtered().filter(x=>collectibleOnPlan(x,p));for(const x of rows){const b=node('button','','pin '+x.kind+(x.owned===true?' owned':x.owned==null?' unknown':'')+(selected===x.id?' selected':''));b.append(collectibleIcon(x,'pin-icon'));b._w=[x.position[0],x.position[2]];b.style.left=ox+x.position[0]*scale+'px';b.style.top=oy+x.position[2]*scale+'px';b.setAttribute('aria-label',title(x)+' · '+status(x)+' · '+x.id.slice(-4));b.title=title(x)+' · '+status(x);b.onclick=()=>selectItem(x);w.append(b);}drawPlayerMarker(w,p);$('map-caption').textContent=mapSyncNotice||(p.interior?p.label+T(' · Plan issu de la géométrie du jeu'):!p.layers.length?T('Plan détaillé indisponible · Position dans la zone'):(p.floor?T('Étage ')+p.floor+' · ':'')+rows.length+(rows.length>1?T(' repères'):T(' repère'))+T(' · Glisser pour déplacer · Molette pour zoomer'));}
function zoom(f){pauseFollowing();if(!(scale>0)){fit();return;}const r=$('map').getBoundingClientRect(),next=Math.max(.015,Math.min(40,scale*f)),ratio=next/scale;ox=r.width/2-(r.width/2-ox)*ratio;oy=r.height/2-(r.height/2-oy)*ratio;scale=next;draw();rememberMapViewport();}
function render(){applyCollectibleState();$('progress').textContent=state.skulltulas+' / 100 Skulltulas · '+state.maxHearts+T(' cœurs de vie');$('saved').textContent=new Date(state.modified*1000).toLocaleString(NAVI_LOCALE);$('total').textContent=state.inventory.filter(x=>x.count>0).length+T(' objets possédés');renderItems();renderList();$('melodies').replaceChildren(...state.flags.filter(f=>f.id.startsWith('IsGet.Item_Melody')).map(f=>card(songs[f.id.replace('IsGet.Item_Melody_','')]||f.id,f.active?T('Appris'):T('Pas encore appris'),f.active)));const k='navi-notes:'+state.slot;if(noteKey!==k){noteKey=k;try{$('notes').value=localStorage.getItem(k)||'';}catch{}}const slot=$('slot').value;$('slot').replaceChildren(new Option(T('Dernière sauvegarde'),'latest'),...state.slots.map(s=>new Option(s.id,s.id)));$('slot').value=slot;if($('slot').value!==slot)$('slot').value='latest';if(selected)showDetail(catalog.find(x=>x.id===selected));renderStats();renderQuests();syncPickers();}
async function refresh(){if(busy){refreshAgain=true;return;}busy=true;try{const asked=$('slot').value;const r=await fetch('/api/state?slot='+encodeURIComponent(asked),{signal:AbortSignal.timeout(10000)});const d=await r.json().catch(()=>({error:T('réponse inattendue du serveur (')+r.status+')'}));if(!r.ok||d.error)throw Error(d.error||T('erreur ')+r.status);if(asked!==$('slot').value){refreshAgain=true;return;}for(const x of d.activity?.records||[]){x.label=T(x.label);x.unit=T(x.unit);}const firstLoad=!state;const locationChanged=!state||state.slot!==d.slot||state.area!==d.area;const changed=locationChanged||state.slot!==d.slot||state.modified!==d.modified||state.activity?.emulatorSeconds!==d.activity?.emulatorSeconds;const previous=state;state=d;if(changed){try{render();}catch(e){state=previous;throw e;}}if(alignSaveOnRefresh||(locationChanged&&$('follow-player').checked)){alignMapWithSave({preserveZoom:!firstLoad});if(firstLoad)restoreMapViewport();alignSaveOnRefresh=false;}$('error').hidden=true;$('connection').textContent=T('Sauvegarde connectée');}catch(e){$('error').hidden=false;$('error').textContent=T('Lecture impossible : ')+(e.name==='TimeoutError'?T('le serveur Navi ne répond pas'):T(e.message));$('connection').textContent=T('Hors connexion');}finally{busy=false;if(refreshAgain){refreshAgain=false;refresh();}}}
for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==b.dataset.view);document.querySelectorAll('[data-view]').forEach(n=>n.removeAttribute('aria-current'));b.setAttribute('aria-current','page');if(b.dataset.view==='carte'){if(needsFit||!(scale>0))fit();else draw();}};
for(const b of document.querySelectorAll('[data-kind]'))b.onclick=()=>{kind=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(n=>n.setAttribute('aria-pressed',String(n===b)));renderList();};
$('region').onchange=()=>{pauseFollowing();setRegion($('region').value);rememberMapViewport();};$('plan').onchange=()=>{pauseFollowing();const bank=$('plan').value.split('/')[6]||'';preferredEra=bank.includes('_Adult')?'Adult':bank.includes('_Child')?'Child':preferredEra;fit();renderList();};$('map-search').oninput=renderList;$('status-filter').onchange=renderList;$('local-only').onchange=renderList;$('fit').onclick=()=>{pauseFollowing();fit();rememberMapViewport();};$('zoom-in').onclick=()=>zoom(1.3);$('zoom-out').onclick=()=>zoom(1/1.3);$('refresh').onclick=()=>{alignSaveOnRefresh=true;refresh();};$('slot').onchange=()=>{alignSaveOnRefresh=true;refresh();};$('search').oninput=renderItems;$('filter').onchange=renderItems;
$('map').ondragstart=e=>e.preventDefault();$('map').onpointerdown=e=>{if(e.button!==0||e.target.closest('button,a,input,select,textarea'))return;e.preventDefault();pauseFollowing();$('map').focus({preventScroll:true});drag={x:e.clientX,y:e.clientY,ox,oy};$('map').setPointerCapture(e.pointerId);};$('map').onpointermove=e=>{if(!drag)return;ox=drag.ox+e.clientX-drag.x;oy=drag.oy+e.clientY-drag.y;pan();};$('map').onpointerup=$('map').onpointercancel=$('map').onlostpointercapture=()=>{if(drag)rememberMapViewport();drag=null;};$('map').onkeydown=e=>{const d={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[e.key];if(d){e.preventDefault();pauseFollowing();ox+=d[0];oy+=d[1];pan();rememberMapViewport();}};
$('mobile-list').onclick=()=>{const open=$('carte').classList.toggle('show-list');$('mobile-list').textContent=open?T('Revenir à la carte'):T('Liste des repères');};
$('notes').oninput=()=>{if(noteKey)try{localStorage.setItem(noteKey,$('notes').value);$('note-status').textContent=T('Notes enregistrées');}catch{$('note-status').textContent=T('Stockage indisponible : exporte tes notes.');}};
$('export').onclick=()=>{if(!state)return;const url=URL.createObjectURL(new Blob([JSON.stringify({...state,notes:$('notes').value},null,2)],{type:'application/json'}));const a=node('a','');a.href=url;a.download='navi-'+state.slot+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
let mapSize=null;
new ResizeObserver(()=>{const r=$('map').getBoundingClientRect();if($('carte').hidden||!r.width||!r.height)return;if(mapSize){ox+=(r.width-mapSize.width)/2;oy+=(r.height-mapSize.height)/2;draw();}mapSize={width:r.width,height:r.height};}).observe($('map'));
(async function start(){try{[catalog,plans]=await Promise.all(['/collectibles.json','/plans.json'].map(async u=>{const r=await fetch(u);if(!r.ok)throw Error(T('Données de carte indisponibles'));return r.json();}));localizeData(catalog);localizeData(plans);$('region').replaceChildren(...[...new Set(plans.map(p=>p.id.split('/')[5]))].sort((a,b)=>regionName(a).localeCompare(regionName(b),NAVI_LANG)).map(k=>new Option(regionName(k),k)));setRegion('KakarikoVillage');await refresh();setInterval(refresh,5000);checkUpdate();const wanted=new URLSearchParams(location.search).get('view');if(wanted)[...document.querySelectorAll('[data-view]')].find(b=>b.dataset.view===wanted)?.click();}catch(e){$('error').hidden=false;$('error').textContent=e.message+T(' · Nouvel essai dans 5 secondes.');setTimeout(start,5000);}})();
const pickers=[];
function syncPickers(){pickers.forEach(p=>p.sync());}
function installPicker(select){
 const label=select.getAttribute('aria-label')||T('Choisir'),wrap=node('div','','region-picker picker-'+select.id),trigger=node('button','','region-trigger'),menu=node('div','','region-menu'),input=node('input',''),list=node('div','','region-options');
 trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',label);trigger.setAttribute('aria-controls','picker-menu-'+select.id);menu.id='picker-menu-'+select.id;menu.hidden=true;menu.setAttribute('role','dialog');menu.setAttribute('aria-label',label);input.type='search';input.placeholder=T('Rechercher…');input.setAttribute('aria-label',T('Rechercher : ')+label);list.setAttribute('role','listbox');list.setAttribute('aria-label',label);
 select.after(wrap);select.hidden=true;wrap.append(trigger,menu);menu.append(input,list);
 const sync=()=>{trigger.replaceChildren(node('span',select.selectedOptions[0]?.textContent||label,'picker-label'),node('span','','picker-chevron'));trigger.disabled=select.disabled||!select.options.length;};
 const close=focus=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');if(focus)trigger.focus();};
 const fill=()=>{const normalize=t=>t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const choices=[...select.options].filter(o=>normalize(o.text).includes(normalize(input.value)));list.replaceChildren(...choices.map(o=>{const b=node('button',o.text+(o.selected?'  ✓':''),'region-option');b.type='button';b.disabled=o.disabled;b.setAttribute('role','option');b.setAttribute('aria-selected',String(o.selected));b.onclick=()=>{select.value=o.value;select.dispatchEvent(new Event('change',{bubbles:true}));syncPickers();close(true);};return b;}));if(!choices.length)list.append(node('p',T('Aucun résultat.'),'muted'));};
 const open=()=>{pickers.forEach(p=>p.close(false));menu.hidden=false;trigger.setAttribute('aria-expanded','true');input.value='';input.hidden=select.options.length<7;fill();const r=wrap.getBoundingClientRect();menu.style.left='0';menu.style.right='auto';if(r.left+310>innerWidth){menu.style.left='auto';menu.style.right='0';}if(input.hidden)list.querySelector('[aria-selected=true]')?.focus();else input.focus();};
 trigger.onclick=()=>menu.hidden?open():close(false);trigger.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open();}};input.oninput=fill;
 menu.onkeydown=e=>{const options=[...list.querySelectorAll('button:not(:disabled)')];const at=options.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?options.length-1:at<0?(e.key==='ArrowUp'?options.length-1:0):(at+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options[i]?.focus();}else if(e.key==='Enter'&&document.activeElement===input){e.preventDefault();options[0]?.click();}};
 document.addEventListener('pointerdown',e=>{if(!wrap.contains(e.target))close(false);});wrap.addEventListener('focusout',e=>{if(!wrap.contains(e.relatedTarget))close(false);});new MutationObserver(()=>{sync();if(!menu.hidden)fill();}).observe(select,{childList:true,subtree:true,attributes:true});select.addEventListener('change',sync);pickers.push({sync,close});sync();
}
document.querySelectorAll('select').forEach(installPicker);
function renderStats(){
 if(!state)return;renderActivity();const count=prefix=>state.inventory.filter(i=>i.id.startsWith(prefix)&&i.count>0).length;const learned=state.flags.filter(f=>f.id.startsWith('IsGet.Item_Melody')&&f.active).length;
 $('stats-context').textContent=state.slot+T(' · Sauvegarde du ')+new Date(state.modified*1000).toLocaleString(NAVI_LOCALE);
 $('stat-cards').replaceChildren(...[[state.hearts+' / '+state.maxHearts,T('Cœurs de vie'),T('Vie actuelle / capacité')],[state.rupees+' / '+state.wallet,T('Rubis'),T('Bourse actuelle / capacité')],[state.skulltulas+' / 100',T('Skulltulas d’or'),state.collectibles.skullVerified?T('Identifiants individuels vérifiés'):T('Vérification individuelle indisponible')],[state.inventory.filter(i=>i.count>0).length,T('Objets présents'),T('Types présents dans la sacoche')]].map(([v,l,h])=>{const el=node('article','','stat-card');el.append(node('p',l,'eyebrow'),node('strong',v),node('p',h,'muted'));return el;}));
 const collection=$('collection-stats');collection.replaceChildren();for(const [label,n,total]of [[T('Pierres ancestrales'),count('Item_Stone_'),3],[T('Médaillons'),count('Item_Medal_'),6],[T('Chants identifiables appris'),learned,8]]){const row=node('div','','collection-row'),head=node('div','','bar-heading'),bar=document.createElement('progress');head.append(node('span',label),node('strong',n+' / '+total));bar.max=total;bar.value=n;bar.setAttribute('aria-label',label);row.append(head,bar);collection.append(row);}const hearts=catalog.filter(x=>x.kind==='heart');const summary=node('div','','heart-summary');summary.append(node('h3',T('Fragments de cœur repérés')));for(const [text,n]of [[T('Obtenus confirmés'),hearts.filter(x=>x.owned===true).length],[T('À trouver confirmés'),hearts.filter(x=>x.owned===false).length],[T('À vérifier'),hearts.filter(x=>x.owned==null).length]]){const row=node('div','','bar-heading');row.append(node('span',text),node('strong',String(n)));summary.append(row);}collection.append(summary);
 const regions=[...new Set(catalog.filter(x=>x.kind==='skull').map(x=>x.map))].sort((a,b)=>regionName(a).localeCompare(regionName(b),NAVI_LANG));$('region-stats').replaceChildren(...regions.map(id=>{const rows=catalog.filter(x=>x.kind==='skull'&&x.map===id),owned=rows.filter(x=>x.owned===true).length,unknown=rows.filter(x=>x.owned==null).length,b=node('button','','regional-stat'),head=node('span','','bar-heading'),track=node('span','','stat-track'),fill=node('span','','stat-fill');head.append(node('span',regionName(id)),node('strong',unknown?T('À vérifier'):owned+' / '+rows.length));fill.style.width=owned/rows.length*100+'%';track.append(fill);b.append(head,track);b.onclick=()=>{document.querySelector('[data-view="carte"]').click();kind='skull';document.querySelectorAll('[data-kind]').forEach(n=>n.setAttribute('aria-pressed',String(n.dataset.kind==='skull')));$('map-search').value='';$('status-filter').value='all';$('local-only').checked=true;setRegion(id);syncPickers();};return b;}));
}

function renderActivity(){const activity=state.activity;const list=$('activity-stats');list.replaceChildren();if(!activity){list.append(node('p',T('Chargement des activités…'),'muted'));return;}const seconds=activity.emulatorSeconds;const values=[[T('Temps enregistré par Fritchii'),seconds==null?T('Indisponible'):Math.floor(seconds/3600)+' h '+String(Math.floor(seconds/60)%60).padStart(2,'0')+' min'],...activity.records.map(r=>[r.label,r.value==null?T('Indisponible'):r.value.toLocaleString(NAVI_LOCALE)+' '+r.unit])];for(const [label,value]of values){const item=node('div','','activity-stat');item.append(node('span',label),node('strong',value));list.append(item);}}
const questRoute=[
 ['deku',T('Sauver l’Arbre Mojo'),T('Enfant'),T('Forêt Kokiri'),[T('Trouver l’épée Kokiri et un bouclier, puis rejoindre l’Arbre Mojo.'),T('Terminer le donjon et obtenir l’Émeraude Kokiri.')],'Item_Stone_Forest','KokiriForest'],
 ['zelda',T('Rencontrer Zelda'),T('Enfant'),T('Château d’Hyrule'),[T('Se rendre au château et rencontrer la princesse.'),T('Apprendre la Berceuse de Zelda auprès d’Impa.')],'song:ZeldaLullaby','HyruleCastle'],
 ['saria',T('Retrouver Saria'),T('Enfant'),T('Bois perdus'),[T('Traverser les Bois perdus jusqu’au Bosquet sacré.'),T('Apprendre le Chant de Saria, utile pour rencontrer Darunia.')],'song:SariaSong','LostWood'],
 ['dodongo',T('Aider les Gorons'),T('Enfant'),T('Mont du Péril'),[T('Rencontrer Darunia au village Goron.'),T('Explorer la caverne Dodongo et obtenir le Rubis Goron.')],'Item_Stone_Fire','DodongoCavern'],
 ['jabu',T('Retrouver la princesse Ruto'),T('Enfant'),T('Domaine Zora'),[T('Explorer le Domaine Zora et obtenir l’accès à Jabu-Jabu.'),T('Terminer son donjon pour recevoir le Saphir Zora.')],'Item_Stone_Water','ZoraDomain'],
 ['time',T('Ouvrir la porte du Temps'),T('Enfant → adulte'),T('Temple du Temps'),[T('Avec les trois pierres ancestrales, retourner vers le château.'),T('Récupérer l’Ocarina du Temps puis suivre l’histoire au Temple du Temps.')],'Item_Medal_Light',null],
 ['hookshot',T('Récupérer le Grappin'),T('Adulte'),T('Cimetière de Cocorico'),[T('Rejoindre la tombe d’Igor et participer à sa course.'),T('Récupérer le Grappin pour atteindre le Temple de la Forêt.')],'Item_Hookshot','Graveyard'],
 ['forest',T('Terminer le Temple de la Forêt'),T('Adulte'),T('Bosquet sacré'),[T('Rejoindre le Bosquet sacré, apprendre le Menuet des Bois et entrer avec le Grappin.'),T('Explorer le temple et obtenir le Médaillon de la Forêt.')],'Item_Medal_Forest','ForestTemple'],
 ['fire',T('Terminer le Temple du Feu'),T('Adulte'),T('Cratère du Péril'),[T('Retourner au village Goron et préparer une protection contre la chaleur.'),T('Rejoindre le cratère puis terminer le Temple du Feu.')],'Item_Medal_Fire','FireTemple'],
 ['ice',T('Explorer la Caverne polaire'),T('Adulte'),T('Fontaine Zora'),[T('Rejoindre la Fontaine Zora et la Caverne polaire.'),T('Récupérer les bottes de plomb et apprendre la Sérénade de l’Eau.')],'Armor_Adult_HeavyBoot','IceCavern'],
 ['water',T('Terminer le Temple de l’Eau'),T('Adulte'),T('Lac Hylia'),[T('Préparer les bottes de plomb et l’équipement pour explorer sous l’eau.'),T('Explorer le temple et obtenir le Médaillon de l’Eau.')],'Item_Medal_Water','WaterTemple'],
 ['well',T('Explorer le fond du puits'),T('Enfant'),T('Village Cocorico'),[T('Apprendre le Chant des Tempêtes auprès du musicien du moulin à l’âge adulte.'),T('Redevenir enfant, jouer ce chant au moulin et explorer le puits pour obtenir le Monocle de Vérité.')],'Armor_GlassTruth','BottomOfTheWell'],
 ['shadow',T('Terminer le Temple de l’Ombre'),T('Adulte'),T('Cimetière de Cocorico'),[T('Retourner à Cocorico après les temples de la Forêt, du Feu et de l’Eau pour poursuivre l’histoire.'),T('Apprendre le Nocturne de l’Ombre, préparer le Feu de Din et explorer le temple.')],'Item_Medal_Shadow','ShadowTemple'],
 ['gerudo',T('Gagner la confiance des Gerudos'),T('Adulte'),T('Forteresse Gerudo'),[T('Rejoindre la forteresse et délivrer les charpentiers.'),T('Obtenir le laissez-passer Gerudo avant de traverser le désert.')],'Item_Token_Gerudo','GerudoFortress'],
 ['spirit-child',T('Explorer le Temple de l’Esprit enfant'),T('Adulte → enfant'),T('Colosse du désert'),[T('Traverser le désert et apprendre le Requiem des Esprits.'),T('Revenir enfant au Colosse et explorer la partie accessible du temple pour obtenir les gantelets d’argent.')],'Armor_Adult_Gauntlet_Silver','SpiritTemple'],
 ['spirit',T('Terminer le Temple de l’Esprit'),T('Adulte'),T('Colosse du désert'),[T('Revenir adulte pour explorer l’autre partie du temple.'),T('Obtenir le bouclier miroir puis le Médaillon de l’Esprit.')],'Item_Medal_Spirit','SpiritTemple'],
 ['final',T('Rejoindre le château de Ganon'),T('Adulte'),T('Château de Ganon'),[T('Après les cinq temples adultes, retourner au Temple du Temps pour poursuivre l’histoire.'),T('Avec les flèches de lumière, rejoindre le château et terminer l’aventure.')],null,'GanonCastle']
];
const questExtras=[
 ['epona',T('Retrouver Epona'),T('Enfant puis adulte'),T('Ranch Lon Lon'),[T('Enfant : rencontrer Malon au ranch et apprendre le Chant d’Epona.'),T('Adulte : revenir au ranch, appeler Epona et relever le défi d’Ingo.')],null,'HyruleField'],
 ['din',T('Obtenir le Feu de Din'),T('Enfant'),T('Sommet du Mont du Péril'),[T('Après la caverne Dodongo, rejoindre la Grande Fée au sommet du Mont du Péril.'),T('Préparer la Berceuse de Zelda et 25 rubis pour l’offrande.')],'Item_DinFire','DeathMountainTrail'],
 ['biggoron',T('Obtenir l’épée Biggoron'),T('Adulte'),T('Cocorico → Mont du Péril'),[T('Commencer la suite d’échanges auprès de la femme aux cocottes à Cocorico.'),T('Poursuivre les échanges jusqu’à Biggoron ; certains trajets sont chronométrés.')],'Weapon_Sword_Biggoron','DeathMountainTrail'],
 ['fire-arrow',T('Trouver les flèches de feu'),T('Adulte, après le Temple de l’Eau'),T('Lac Hylia'),[T('Revenir au lac une fois le Temple de l’Eau terminé.'),T('Lire l’indice sur la stèle et utiliser l’arc au lever du soleil.')],'Item_Arrow_Fire','HyruleField'],
 ['training',T('Explorer le gymnase Gerudo'),T('Adulte, après le laissez-passer'),T('Forteresse Gerudo'),[T('Préparer les outils récupérés dans les temples.'),T('Résoudre les épreuves du gymnase pour obtenir les flèches de glace.')],'Item_Arrow_Ice','GerudoFortress'],
 ['skulls',T('Retrouver les Skulltulas d’or'),T('Tout au long de l’aventure'),T('Tout Hyrule'),[T('Consulter les repères synchronisés dans la carte.'),T('Revenir à la maison des Skulltulas de Cocorico pour les récompenses.')],'skulls',null],
 ['hearts',T('Augmenter sa réserve de vie'),T('Tout au long de l’aventure'),T('Tout Hyrule'),[T('Explorer les zones et participer aux mini-jeux pour trouver les fragments de cœur.'),T('Le suivi individuel des fragments est encore partiel dans Navi.')],null,null]
];
let questCategory='main';
function questAuto(q){if(!state)return false;const progress=currentQuests()[q[0]];if(progress)return progress.complete;const key=q[5];if(!key)return false;if(key==='skulls')return state.skulltulas===100;if(key.startsWith('song:'))return state.flags.some(f=>f.id==='IsGet.Item_Melody_'+key.slice(5)&&f.active);const upgrades={Item_Hookshot:['Item_Longshot'],Armor_Adult_Gauntlet_Silver:['Armor_Adult_Gauntlet_Gold']};return state.inventory.some(i=>(i.id===key||(upgrades[key]||[]).includes(i.id))&&i.count>0);}
function questChecks(){try{return JSON.parse(localStorage.getItem('navi-quests:'+state.slot)||'{}');}catch{return {};}}
function renderQuests(){if(!state)return;const openSteps=new Set([...$('quest-list').querySelectorAll('.quest-step:has(details[open])')].map(n=>n.id));const checks=questChecks(),done=q=>questAuto(q)||checks[q[0]]===true;const next=questRoute.find(q=>!done(q)),hero=$('quest-next');hero.replaceChildren(node('p',T('PROCHAINE ÉTAPE CONSEILLÉE'),'eyebrow'),node('h2',next?next[1]:T('Parcours principal terminé')),node('p',next?next[2]+' · '+next[3]:T('Toutes les étapes du carnet sont cochées.'),'muted'));if(next){hero.append(node('p',next[4][0]));const jump=node('button',T('Voir cette étape ↓'));jump.onclick=()=>{questCategory='main';$('quest-hide').checked=false;renderQuests();$('quest-'+next[0]).scrollIntoView({behavior:'smooth',block:'center'});};hero.append(jump);}const rows=questCategory==='main'?questRoute:questExtras;$('quest-main').setAttribute('aria-pressed',String(questCategory==='main'));$('quest-side').setAttribute('aria-pressed',String(questCategory==='side'));$('quest-summary').textContent=rows.filter(done).length+' / '+rows.length+T(' étapes terminées · ')+state.slot;renderDial(questRoute.filter(done).length,questRoute.length);const visible=rows.filter(q=>!$('quest-hide').checked||!done(q));$('quest-list').replaceChildren(...visible.map(q=>{const li=node('li','','quest-step'+(done(q)?' complete':next?.[0]===q[0]?' next':''));li.id='quest-'+q[0];li.value=rows.indexOf(q)+1;const head=node('div','','quest-step-head'),n=node('span',String(rows.indexOf(q)+1).padStart(2,'0'),'quest-number'),text=node('div','');text.append(node('p',q[2]+' · '+q[3],'muted'),node('h2',q[1]));const reward=questRewardIcon(q);if(reward)n.replaceChildren(reward);head.append(n,text);li.append(head);const tag=node('span',done(q)?T('✓ Terminée'):next?.[0]===q[0]?T('À faire ensuite'):currentQuests()[q[0]]?.started?T('En cours'):T('À faire'),'quest-state');tag.title=questAuto(q)?($('slot').value==='latest'&&liveState?.connected&&currentQuests()[q[0]]?T('Confirmé en direct'):T('Confirmé par la sauvegarde')):checks[q[0]]?T('Coché dans ton carnet'):'';li.append(tag);const details=document.createElement('details'),summary=node('summary',T('Les étapes à suivre'));details.open=openSteps.has(li.id);details.append(summary);const tasks=node('ol','');q[4].forEach(t=>tasks.append(node('li',t)));details.append(tasks);li.append(details);const actions=node('div','','quest-actions');if(!questAuto(q)){const label=node('label','','check'),input=document.createElement('input');input.type='checkbox';input.checked=!!checks[q[0]];input.onchange=()=>{try{const stored=questChecks();stored[q[0]]=input.checked;localStorage.setItem('navi-quests:'+state.slot,JSON.stringify(stored));renderQuests();}catch{$('quest-summary').textContent=T('Impossible d’enregistrer la case dans ce navigateur.');}};label.append(input,document.createTextNode(T('Marquer comme terminé')));actions.append(label);}if(q[6]&&catalog.some(x=>x.map===q[6])){const map=node('button',T('Voir la région ↗'));map.onclick=()=>{pauseFollowing();document.querySelector('[data-view="carte"]').click();setRegion(q[6]);};actions.append(map);}li.append(actions);return li;}));let previousGroup='';for(const li of [...$('quest-list').children]){const q=rows.find(x=>'quest-'+x[0]===li.id);if(!q)continue;const group=questCategory==='side'?T('DÉTOURS & RÉCOMPENSES'):rows.indexOf(q)<6?T('I · LES PIERRES ANCESTRALES'):rows.indexOf(q)<13?T('II · LE RÉVEIL DES SAGES'):T('III · VERS LE DÉNOUEMENT');if(group!==previousGroup){const divider=node('li',group,'quest-group');li.before(divider);previousGroup=group;}}insertQuestDetours(rows,checks);if(!visible.length)$('quest-list').append(node('li',T('Toutes ces étapes sont terminées. Décoche le filtre pour les revoir.'),'muted'));}
$('quest-main').onclick=()=>{questCategory='main';renderQuests();};$('quest-side').onclick=()=>{questCategory='side';renderQuests();};$('quest-hide').onchange=renderQuests;
function requirementStatus(r){if(!state)return [T('À préparer'),'unknown'];if(r.items)return state.inventory.some(i=>r.items.includes(i.id)&&i.count>0)?[T('Possédé'),'ready']:[T('Manquant'),'missing'];if(r.song){const f=state.flags.find(f=>f.id==='IsGet.Item_Melody_'+r.song);return f?[f.active?T('Appris'):T('À apprendre'),f.active?'ready':'missing']:[T('À préparer'),'unknown'];}if(r.condition==='tokens50')return [state.skulltulas+T(' / 50 jetons'),state.skulltulas>=50?'ready':'missing'];if(r.condition==='either')return [T('Deux époques'),'ready'];if(['child','adult'].includes(r.condition)){const match=state.area.match(/_(Child|Adult)(?:_|$)/);return match?[match[1].toLowerCase()===r.condition?T('Époque sauvegardée'):T('Changer d’époque'),match[1].toLowerCase()===r.condition?'ready':'missing']:[T('Époque à choisir'),'unknown'];}return [T('Sur place'),'unknown'];}
function addRequirements(x){const section=node('section','','requirements');section.append(node('h3',T('Prérequis & conditions')));const list=node('ul','');for(const r of x.requirements||[]){const [label,cls]=requirementStatus(r),li=node('li','');li.append(node('span',r.label),node('small',label,'requirement-state '+cls));list.append(li);}section.append(list,node('p',x.requirementsCoverage||T('Les conditions de cette salle restent à documenter.'),'muted'));$('detail').append(section);}


const itemArt={"Armor_Adult_Gauntlet_Gold": "item-golden-gauntlets-1.webp", "Armor_Adult_Gauntlet_Silver": "item-silver-gauntlets-1.webp", "Armor_Adult_Goron": "item-goron-tunic-1.webp", "Armor_Adult_HeavyBoot": "item-iron-boots.webp", "Armor_Adult_HoverBoot": "item-hover-boots-1.webp", "Armor_Adult_Normal": "item-heros-clothes.webp", "Armor_Adult_Zora": "item-zora-tunic-1.webp", "Armor_Child_Gauntlet_Goron": "item-goron-bracelet-1.webp", "Armor_Child_Mask_Bunny": "item-bunny-hood-1.webp", "Armor_Child_Mask_Keaton": "item-keaton-mask-1.webp", "Armor_Child_Mask_Skull": "item-skull-mask-1.webp", "Armor_Child_Mask_Spooky": "item-spooky-mask-1.webp", "Armor_Child_Mask_Truth": "item-mask-of-truth-1.webp", "Armor_GlassTruth": "item-lenses-of-truth-1.webp", "Item_AgonyStone": "item-echo-gem.webp", "Item_Arrow_Fire": "item-fire-arrow-1.webp", "Item_Arrow_Ice": "item-ice-arrow-1.webp", "Item_Arrow_Light": "item-light-arrow-1.webp", "Item_Bomb": "item-bomb.webp", "Item_BombBag_Large": "item-biggest-bomb-bag-1.webp", "Item_BombBag_Medium": "item-bigger-bomb-bag-1.webp", "Item_BombBag_Small": "item-bomb-bag.webp", "Item_Bombchu": "item-bombchu-1.webp", "Item_Boomerang": "item-boomerang.webp", "Item_DekuNut": "item-deku-nut.webp", "Item_DekuStick": "item-deku-stick.webp", "Item_DinFire": "item-dins-fire.webp", "Item_FairyBless_DefenseDouble": "item-gift-of-halved-damage.webp", "Item_FairyBless_MPDouble": "item-gift-of-doubled-magic.webp", "Item_FaroreWind": "item-farores-wind-1.webp", "Item_Hammer": "item-megaton-hammer-1.webp", "Item_Hookshot": "item-hookshot.webp", "Item_Longshot": "item-longshot-1.webp", "Item_MagicBean": "item-magic-beans.webp", "Item_Medal_Fire": "item-fire-medallion-1.webp", "Item_Medal_Forest": "item-forest-medallion-1.webp", "Item_Medal_Light": "item-light-medallion-1.webp", "Item_Medal_Shadow": "item-shadow-medallion-1.webp", "Item_Medal_Spirit": "item-spirit-medallion-1.webp", "Item_Medal_Water": "item-water-medallion-1.webp", "Item_NayruLove": "item-nayrus-love-1.webp", "Item_Ocarina_Fairy": "item-fairy-ocarina.webp", "Item_Ocarina_Time": "item-ocarina-of-time.webp", "Item_PocketEgg": "item-pocket-egg-1.webp", "Item_Quiver_Large": "item-biggest-quiver-1.webp", "Item_Quiver_Medium": "item-bigger-quiver-1.webp", "Item_Scale_Gold": "item-golden-scale-1.webp", "Item_Scale_Silver": "item-silver-scale-1.webp", "Item_Stone_Fire": "item-goron-ruby.webp", "Item_Stone_Forest": "item-kokiri-emerald.webp", "Item_Stone_Water": "item-zora-sapphire.webp", "Item_Wallet_Large": "item-giants-wallet-1.webp", "Item_Wallet_Medium": "item-adults-wallet-1.webp", "Obj_Heart_Piece": "item-piece-of-heart-1.webp", "Weapon_Range_Bow": "item-fairy-bow.webp", "Weapon_Range_SlingShot": "item-fairy-slingshot.webp", "Weapon_Shield_Deku": "item-deku-shield.webp", "Weapon_Shield_Hylian": "item-hylian-shield.webp", "Weapon_Shield_Mirror": "item-mirror-shield-1.webp", "Weapon_Sword_Biggoron": "item-biggoron-sword.webp", "Weapon_Sword_Giant": "item-giants-knife-1.webp", "Weapon_Sword_Kokiri": "item-kokiri-sword.webp", "Weapon_Sword_Master": "item-master-sword.webp", "Item_Token_Gold": "item-golden-skull-token-1.webp"};
const labelArt={"Kokiri Sword": "item-kokiri-sword.webp", "Master Sword": "item-master-sword.webp", "Giant's Knife": "item-giants-knife-1.webp", "Biggoron Sword": "item-biggoron-sword.webp", "Deku Shield": "item-deku-shield.webp", "Hylian Shield": "item-hylian-shield.webp", "Mirror Shield": "item-mirror-shield-1.webp", "Hero's Clothes": "item-heros-clothes.webp", "Goron Tunic": "item-goron-tunic-1.webp", "Zora Tunic": "item-zora-tunic-1.webp", "Iron Boots": "item-iron-boots.webp", "Hover Boots": "item-hover-boots-1.webp", "Fairy Slingshot": "item-fairy-slingshot.webp", "Great Deku Tree": "character-great-deku-tree.webp", "Fairy Bow": "item-fairy-bow.webp", "Fire Arrow": "item-fire-arrow-1.webp", "Ice Arrow": "item-ice-arrow-1.webp", "Light Arrow": "item-light-arrow-1.webp", "Boomerang": "item-boomerang.webp", "Hookshot": "item-hookshot.webp", "Longshot": "item-longshot-1.webp", "Megaton Hammer": "item-megaton-hammer-1.webp", "Goron Bracelet": "item-goron-bracelet-1.webp", "Silver Gauntlets": "item-silver-gauntlets-1.webp", "Golden Gauntlets": "item-golden-gauntlets-1.webp", "Bomb Bag": "item-bomb-bag.webp", "Bombchu": "item-bombchu-1.webp", "Deku Stick": "item-deku-stick.webp", "Deku Nut": "item-deku-nut.webp", "Din's Fire": "item-dins-fire.webp", "Farore's Wind": "item-farores-wind-1.webp", "Nayru's Love": "item-nayrus-love-1.webp", "Gift of Doubled Magic": "item-gift-of-doubled-magic.webp", "Lenses of Truth": "item-lenses-of-truth-1.webp", "Silver Scale": "item-silver-scale-1.webp", "Golden Scale": "item-golden-scale-1.webp", "Echo Gem": "item-echo-gem.webp", "Fairy Ocarina": "item-fairy-ocarina.webp", "Ocarina of Time": "item-ocarina-of-time.webp", "Magic Beans": "item-magic-beans.webp", "Piece of Heart": "item-piece-of-heart-1.webp", "Heart Container": "item-heart-container.webp", "Golden Skull Token": "item-golden-skull-token-1.webp", "Cucco": "character-cucco.webp", "Bomb": "item-bomb.webp", "Kaepora Gaebora": "character-kaepora-gaebora.webp", "Epona": "character-epona.webp", "Gohma": "boss-gohma.webp", "King Dodongo": "boss-king-dodongo.webp", "Barinade": "boss-barinade.webp", "Phantom Ganon": "boss-phantom-ganon.webp", "Volvagia": "boss-volvagia.webp", "Morpha": "boss-morpha.webp", "Bongo Bongo": "boss-bongo-bongo.webp", "Twinrova": "boss-twinrova.webp", "Zelda's Lullaby": "song-zeldas-lullaby.webp", "Sun's Song": "song-suns-song.webp", "Epona's Song": "song-eponas-song.webp", "Saria's Song": "song-sarias-song.webp", "Song of Time": "song-song-of-time.webp", "Song of Storms": "song-song-of-storms.webp", "Minuet of the Forest": "song-minuet-of-forest.webp", "Prelude of Light": "song-prelude-of-light.webp", "Bolero of Fire": "song-bolero-of-fire.webp", "Serenade of Water": "song-serenade-of-water.webp", "Nocturne of Shadow": "song-nocturne-of-shadow.webp", "Requiem of Spirit": "song-requiem-of-spirit.webp", "Scarecrow Song": "song-scarecrow-song.webp", "Blue Fire": "item-blue-fire-1.webp", "Deku Baba": "enemy-deku-baba.webp", "Keaton Mask": "item-keaton-mask-1.webp", "Skull Mask": "item-skull-mask-1.webp", "Spooky Mask": "item-spooky-mask-1.webp", "Bunny Hood": "item-bunny-hood-1.webp", "Running Man": "character-running-man.webp", "Gold Rupee": "item-gold-rupee-1.webp", "Mask of Truth": "item-mask-of-truth-1.webp", "Empty Bottle": "item-empty-bottle.webp", "Bug": "item-bug-1.webp", "Lon Lon Milk": "item-lon-lon-milk-1.webp", "Talon": "character-talon.webp", "Bottle with Ruto's Letter": "item-bottle-with-rutos-letter-1.webp", "Poe Collector": "character-poe-collector.webp", "Big Poe": "enemy-big-poe.webp", "Great Fairy": "character-great-fairy.webp", "Gift of Halved Damage": "item-gift-of-halved-damage.webp", "Adult's Wallet": "item-adults-wallet-1.webp", "Giant's Wallet": "item-giants-wallet-1.webp", "Bigger Bomb Bag": "item-bigger-bomb-bag-1.webp", "Biggest Bomb Bag": "item-biggest-bomb-bag-1.webp", "Biggest Deku Seed Bag": "item-biggest-deku-seed-bag-1.webp", "Bigger Quiver": "item-bigger-quiver-1.webp", "Biggest Quiver": "item-biggest-quiver-1.webp", "Bigger Deku Stick Bag": "item-bigger-deku-stick-bag-1.webp", "Kokiri Emerald": "item-kokiri-emerald.webp", "Goron Ruby": "item-goron-ruby.webp", "Zora Sapphire": "item-zora-sapphire.webp", "Light Medallion": "item-light-medallion-1.webp", "Forest Medallion": "item-forest-medallion-1.webp", "Fire Medallion": "item-fire-medallion-1.webp", "Water Medallion": "item-water-medallion-1.webp", "Shadow Medallion": "item-shadow-medallion-1.webp", "Spirit Medallion": "item-spirit-medallion-1.webp", "Ganondorf": "boss-ganondorf.webp", "Great Moblin": "boss-great-moblin.webp", "Dark Link": "enemy-dark-link.webp", "Iron Knuckle": "enemy-iron-knuckle.webp", "Malon": "character-malon.webp", "Happy Mask Shopkeeper": "character-happy-mask-shopkeeper.webp", "Pocket Egg": "item-pocket-egg-1.webp"};
function art(file,cls='game-icon'){const im=document.createElement('img');im.src='/assets/'+file;im.alt='';im.className=cls;im.decoding='async';im.onerror=()=>{im.hidden=true;};return im;}
function itemIcon(label){const songIcons={'Boléro du Feu':'song-bolero-of-fire.webp','Requiem des Esprits':'song-requiem-of-spirit.webp','Chant de Saria':'song-sarias-song.webp','Chant des Tempêtes':'song-song-of-storms.webp','Sérénade de l’Eau':'song-serenade-of-water.webp','Berceuse de Zelda':'song-zeldas-lullaby.webp','Menuet des Bois':'song-minuet-of-forest.webp','Nocturne de l’Ombre':'song-nocturne-of-shadow.webp'};let file=songIcons[U(label)]||labelArt[label]||labelArt[U(label)];if(!file){const id=Object.keys(names).find(k=>names[k]===label);file=itemArt[id];}return file?art(file):null;}
function collectibleIcon(x,cls){const wrap=node('span','',cls);wrap.append(art(x.kind==='heart'?'item-piece-of-heart-1.webp':'item-golden-skull-token-1.webp'));if(x.owned===true||x.owned==null)wrap.append(node('span',x.owned===true?'✓':'?','collectible-status'));return wrap;}
function questRewardIcon(q){const file=itemArt[q[5]]||(q[0]==='epona'?'character-epona.webp':q[0]==='final'?'item-master-sword.webp':q[5]?.startsWith('song:')?'item-ocarina-of-time.webp':null);return file?art(file):null;}

const questSchedule=[
 {after:'zelda',id:'epona',check:'epona-song',title:T('Rencontrer Malon et apprendre le Chant d’Epona'),when:T('Après Zelda · avant de devenir adulte'),note:T('Première partie seulement : passer au ranch avec ton ocarina. Epona se récupère plus tard, adulte.')},
 {after:'dodongo',id:'din',when:T('Après la caverne Dodongo · avant Jabu-Jabu'),note:T('Profiter de la visite du Mont du Péril pour obtenir le Feu de Din. Il sera utile au Temple de l’Ombre.')},
 {after:'jabu',id:'hearts',title:T('Faire un tour des régions avec le Boomerang'),when:T('Après Jabu-Jabu · avant la porte du Temps'),note:T('Bon moment pour récupérer des fragments et jetons accessibles enfant. Tu pourras aussi revenir plus tard.')},
 {after:'time',id:'epona',title:T('Libérer Epona au ranch Lon Lon'),when:T('Après la porte du Temps · avant le Temple de la Forêt'),note:T('Revenir adulte avec le Chant d’Epona appris enfant et des rubis pour les courses. Facultatif pour poursuivre l’histoire.')},
 {after:'forest',id:'skulls',title:T('Faire le point sur les récompenses des Skulltulas'),when:T('Après le Temple de la Forêt · avant celui du Feu'),note:T('Passer à la maison des Skulltulas de Cocorico pour réclamer les récompenses correspondant à tes jetons.')},
 {after:'water',id:'fire-arrow',when:T('Juste après le Temple de l’Eau · avant le puits'),note:T('Rester au lac Hylia et suivre l’indice de la stèle au lever du soleil, avec l’Arc des fées.')},
 {after:'water',id:'biggoron',when:T('Après le Temple de l’Eau · avant les derniers temples'),note:T('Créneau conseillé pour la suite d’échanges : plusieurs trajets traversent Hyrule. Certains objets ont une limite de temps.')},
 {after:'spirit',id:'training',when:T('Après le Temple de l’Esprit · avant le château de Ganon'),note:T('Avec les outils des temples, revenir au gymnase Gerudo pour ses épreuves et les flèches de glace.')},
 {after:'spirit',id:'hearts',title:T('Préparer les derniers combats'),when:T('Avant le château de Ganon'),note:T('Compléter les fragments accessibles et refaire le plein de provisions. Ce détour ne bloque pas l’histoire.')}
];
function insertQuestDetours(rows,checks){
 if(questCategory==='side'){for(const q of rows){const li=$('quest-'+q[0]);if(!li)continue;const schedule=questSchedule.filter(x=>x.id===q[0]);const timing=node('p',schedule.map(x=>x.when).join(' • '),'quest-timing');li.append(timing);}return;}
 for(const s of [...questSchedule].reverse()){const q=questExtras.find(q=>q[0]===s.id);if(!q)continue;const complete=s.check?currentQuests()[s.check]?.complete===true:questAuto(q)||checks[q[0]]===true;if($('quest-hide').checked&&complete)continue;let anchor=$('quest-'+s.after);if(!anchor){const index=questRoute.findIndex(q=>q[0]===s.after);const future=questRoute.slice(index+1).map(q=>$('quest-'+q[0])).find(Boolean);if(!future)continue;anchor=future.previousElementSibling;if(!anchor)continue;}const row=node('li','','quest-detour'+(complete?' complete':'')),head=node('div','','detour-heading');head.append(node('span',T('↳ FACULTATIF'),'eyebrow'),node('strong',s.title||q[1]));if(complete)head.append(node('span',T('✓ Terminée'),'quest-state'));row.append(head,node('p',s.when,'quest-timing'),node('p',s.note,'muted'));const btn=node('button',T('Voir la quête annexe'));btn.onclick=()=>{questCategory='side';$('quest-hide').checked=false;renderQuests();const target=$('quest-'+s.id);target.querySelector('details').open=true;target.scrollIntoView({behavior:'smooth',block:'center'});};row.append(btn);anchor.after(row);}
}

function applyUiSize(size,persist=false){if(!['small','normal','large'].includes(size))size='normal';document.documentElement.dataset.uiSize=size;document.querySelectorAll('input[name="ui-size"]').forEach(r=>r.checked=r.value===size);if(persist){try{localStorage.setItem('navi-ui-size',size);$('size-status').textContent=T('Taille ')+size+T(' enregistrée dans ce navigateur.');}catch{$('size-status').textContent=T('Taille appliquée ; enregistrement indisponible dans ce navigateur.');}}pickers.forEach(p=>p.close(false));}
let savedUiSize='normal';try{savedUiSize=localStorage.getItem('navi-ui-size')||'normal';}catch{}applyUiSize(savedUiSize);document.querySelectorAll('input[name="ui-size"]').forEach(r=>r.onchange=()=>applyUiSize(r.value,true));

// Animate a DOM fairy: native CSS cursor images cannot reliably play animation.
(function installNaviCursor(){
 const fine=matchMedia('(hover: hover) and (pointer: fine)');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const root=document.documentElement;
 const fairy=document.createElement('div');
 fairy.className='navi-cursor';fairy.setAttribute('aria-hidden','true');
 fairy.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" focusable="false"><path d="M2 2 6 15 9 9 15 6Z" fill="#f5fbff" stroke="#172c40" stroke-width="1.4" stroke-linejoin="round"/><circle class="fairy-aura" cx="26" cy="27" r="15"/><g class="fairy-wing fairy-wing-left"><path d="M25 26C10 22 8 5 15 9C21 12 25 20 25 26Z"/><path d="M25 28C12 25 12 38 18 35C22 33 24 30 25 28Z"/></g><g class="fairy-wing fairy-wing-right"><path d="M27 26C26 16 39 2 41 10C42 18 33 24 27 26Z"/><path d="M27 28C37 24 42 36 36 36C31 34 28 31 27 28Z"/></g><circle class="fairy-body" cx="26" cy="27" r="5"/></svg>`;
 document.body.append(fairy);
 let frame=0,x=0,y=0,inside=false;
 function hide(){delete root.dataset.naviCursor;fairy.dataset.pressed='false';if(frame){cancelAnimationFrame(frame);frame=0;}}
 function paint(){frame=0;if(!inside||!fine.matches||reduced.matches){hide();return;}
  const target=document.elementFromPoint(x,y);
  if(!target){hide();return;}
  const action=target.closest('a,button,select,summary,label,[role="button"],[role="option"],input[type="checkbox"],input[type="radio"]');
  const native=target.closest('textarea,input:not([type="checkbox"]):not([type="radio"]),[contenteditable]:not([contenteditable="false"]),:disabled,[aria-disabled="true"]');
  if(native){hide();return;}
  fairy.style.transform=`translate3d(${x-2}px,${y-2}px,0)`;
  fairy.dataset.action=String(!!action);root.dataset.naviCursor='active';
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(paint);}
 document.addEventListener('pointermove',e=>{if(e.pointerType!=='mouse'){inside=false;hide();return;}x=e.clientX;y=e.clientY;inside=true;schedule();},{passive:true});
 document.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse'){inside=false;hide();}else fairy.dataset.pressed='true';},{passive:true});
 window.addEventListener('pointerup',()=>{fairy.dataset.pressed='false';},{passive:true});
 document.documentElement.addEventListener('pointerleave',()=>{inside=false;hide();});
 window.addEventListener('blur',()=>{inside=false;hide();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){inside=false;hide();}});
 // Keyboard navigation must not hide or pause the mouse fairy.
 document.addEventListener('scroll',()=>{if(inside)schedule();},{passive:true,capture:true});
 fine.addEventListener('change',()=>{inside=false;hide();});
 reduced.addEventListener('change',()=>{inside=false;hide();});
})();

// The world illustration is an overview: markers open regional plans, not exact actor positions.
const worldRegions=[
 ['HyruleCastle',.41,.26],['Market',.44,.39],['HyruleField',.46,.61],
 ['LonLonRanch',.39,.54,'HyruleField'],['LakeHylia',.40,.82,'HyruleField'],
 ['KakarikoVillage',.62,.44],['Graveyard',.68,.43],['DeathMountainTrail',.59,.33],
 ['GoronCity',.64,.25],['DeathMountainCrater',.63,.14],['ZoraRiver',.72,.48],
 ['ZoraDomain',.86,.47],['ZoraFountain',.79,.34],['IceCavern',.80,.27],
 ['KokiriForest',.76,.68],['LostWood',.72,.61],['SacredForestMeadow',.83,.64],
 ['GerudoValley',.27,.55],['GerudoFortress',.20,.41],['HountedWasteland',.15,.31],
 ['DesertColossus',.18,.21]
];
function syncMapMode(){
 const overview=mapMode==='world';
 $('world-view').setAttribute('aria-pressed',String(overview));$('regional-view').setAttribute('aria-pressed',String(!overview));
 document.querySelector('.map-toolbar').hidden=overview;
 $('map').classList.toggle('is-world',overview);
 document.querySelector('.map-credit').textContent=overview?T('Illustration : Nintendo · via VidaExtra'):T('Plans : Owl Object Map · Nintendo');
 $('map').setAttribute('aria-label',overview?T('Carte complète d’Hyrule. Choisis une région pour ouvrir son plan.'):T('Plan de la zone. Glisser ou flèches pour déplacer, molette ou boutons pour zoomer.'));
}
function drawWorldOverview(){
 const w=$('world');w.replaceChildren();const im=document.createElement('img');
 im.src='/assets/hyrule-world.webp';im.alt=T('Carte complète d’Hyrule');im.draggable=false;
 im.style.cssText=`left:${ox}px;top:${oy}px;width:${1366*scale}px;height:${993*scale}px`;
 w.append(im);
 const savedArea=currentArea().replace(/_(?:Child|Adult)(?:_.*)?$/,'');
 for(const [id,x,y,targetRegion]of worldRegions){
  const current=id===savedArea||id==='LostWood'&&savedArea==='LostWoods';
  const b=node('button','','world-region'+(current?' current':''));
  b.style.left=ox+x*1366*scale+'px';b.style.top=oy+y*993*scale+'px';
  const label=regionName(id)+(current?(liveState?.connected&&$('slot').value==='latest'?T(' · Zone actuelle'):T(' · Zone sauvegardée')):'');
  b.title=label;b.setAttribute('aria-label',T('Ouvrir ')+label);
  b.append(node('span','', 'world-region-dot'),node('span',regionName(id),'world-region-label'));
  b.onclick=()=>{pauseFollowing();setRegion(targetRegion||id);if(targetRegion){const layer=plans.find(p=>p.id===$('plan').value)?.layers.find(l=>l.file.startsWith(id+'_'));if(layer){const r=$('map').getBoundingClientRect();scale=Math.min(r.width/layer.width,r.height/layer.height)*.85;ox=r.width/2-(layer.left+layer.width/2)*scale;oy=r.height/2-(layer.top+layer.height/2)*scale;draw();}}};w.append(b);
 }
 $('map-caption').textContent=T('Choisis une région pour ouvrir son plan · Zoom et déplacement disponibles');
 $('player-status').textContent=savedArea?(liveState?.connected&&$('slot').value==='latest'?T('● En direct · '):T('Zone sauvegardée : '))+regionName(savedArea):'';
}
function playerOnPlan(p){
 const player=currentPlayer();
 if(!player||!Array.isArray(player.position)||player.position.length!==3||!player.position.every(Number.isFinite))return null;
 const bank=p.id.split('/')[6];
 if(bank.replace(/_Alternative$/,'')!==player.area.replace(/_Alternative$/,''))return null;
 if(p.floor ? p.floor!==player.floor : player.plan!==p.id)return null;
 return player;
}
function drawPlayerMarker(w,p){
 const player=playerOnPlan(p);
 $('player-center').disabled=!currentPlayer();
 const actual=currentPlayer();
 $('player-status').textContent=player?(player.source==='live'?T('● Link · En direct'):T('Link · Dernière sauvegarde'))+(player.floor?' · '+player.floor:''):actual?(actual.floor?T('Link se trouve à l’étage ')+actual.floor+T(' · Ma position pour le rejoindre'):actual.plan?T('Link se trouve dans une autre zone'):T('Étage de Link indisponible pour cette position')):T('Position de Link indisponible');
 if(!player)return;
 const marker=node('div','','player-marker');
 marker.style.left=ox+player.position[0]*scale+'px';marker.style.top=oy+player.position[2]*scale+'px';
 marker.setAttribute('role','img');marker.setAttribute('aria-label',player.source==='live'?T('Link — position en direct'):T('Link — position à la dernière sauvegarde'));
 marker.title=player.source==='live'?T('Link · Position en direct'):T('Link · Position sauvegardée le ')+new Date(state.modified*1000).toLocaleString(NAVI_LOCALE);
 const heading=Number.isFinite(player.heading)?((player.heading%360)+360)%360:null;
 marker.dataset.heading=heading===null?'':String(heading);
 const pointer=heading===null?'<circle cx="16" cy="16" r="5" fill="#f5d477"/>':`<path transform="rotate(${heading} 16 16)" d="M16 5 25 24 16 20 7 24Z" fill="#f5d477" stroke="#75521c" stroke-width="1"/>`;
 marker.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#173e4c" stroke="#fff6d2" stroke-width="2"/>'+pointer+'</svg>';
 w.append(marker);
}
$('world-view').onclick=()=>{mapMode='world';syncMapMode();fit();};
$('regional-view').onclick=()=>{mapMode='region';syncMapMode();fit();};
$('player-center').onclick=()=>{
 if(!currentPlayer())return;
 $('follow-player').checked=true;syncFollowButton();
 alignMapWithSave();
 const p=plans.find(p=>p.id===$('plan').value),player=p&&playerOnPlan(p);
 if(player){const r=$('map').getBoundingClientRect();ox=r.width/2-player.position[0]*scale;oy=r.height/2-player.position[2]*scale;draw();}
};

// Wheel zoom is anchored under the pointer and never scrolls the surrounding page.
$('map').addEventListener('wheel',e=>{
 e.preventDefault();
 if(!bounds()||drag||!e.deltaY||!(scale>0))return;
 pauseFollowing();
 const r=$('map').getBoundingClientRect();
 const unit=e.deltaMode===1?16:e.deltaMode===2?r.height:1;
 const factor=Math.exp(-Math.max(-160,Math.min(160,e.deltaY*unit))*.002);
 const next=Math.max(.015,Math.min(40,scale*factor)),ratio=next/scale;
 const x=e.clientX-r.left,y=e.clientY-r.top;
 ox=x-(x-ox)*ratio;oy=y-(y-oy)*ratio;scale=next;draw();rememberMapViewport();
},{passive:false});


function syncFollowButton(){
 const button=$('overlay-follow'),active=$('follow-player').checked;
 button.setAttribute('aria-pressed',String(active));
 button.title=active?T('Désactiver le suivi de Link'):T('Activer le suivi de Link');
}
function pauseFollowing(){ $('follow-player').checked=false;syncFollowButton(); }
function rememberMapViewport(){
 try{localStorage.setItem('navi-map-viewport',JSON.stringify({scale,ox,oy,plan:$('plan').value,mode:mapMode}));}catch{}
}
function restoreMapViewport(){
 try{
  const v=JSON.parse(localStorage.getItem('navi-map-viewport'));
  if(!v||!Number.isFinite(v.scale)||v.scale<.015||v.scale>40||v.mode!=='region')return;
  if(Boolean(plans.find(p=>p.id===v.plan)?.interior)!==Boolean(plans.find(p=>p.id===$('plan').value)?.interior))return;
  scale=v.scale;
  if(v.plan===$('plan').value&&Number.isFinite(v.ox)&&Number.isFinite(v.oy)){ox=v.ox;oy=v.oy;}
  else{const b=bounds(),r=$('map').getBoundingClientRect();if(b){ox=r.width/2-(b.minX+b.maxX)*scale/2;oy=r.height/2-(b.minY+b.maxY)*scale/2;}}
  draw();
 }catch{}
}
$('follow-player').onchange=()=>{if($('follow-player').checked)$('player-center').click();syncFollowButton();};
$('overlay-follow').onclick=()=>{
 if($('follow-player').checked)pauseFollowing();
 else{$('follow-player').checked=true;$('player-center').click();syncFollowButton();}
};
syncFollowButton();
let liveBusy=false,lastLiveArea='';
async function refreshLive(){
 if(liveBusy||document.hidden||!state||$('slot').value!=='latest')return;
 liveBusy=true;
 const previousQuests=JSON.stringify(currentQuests()),previousTokens=currentSkulltulas();
 try{
  const r=await fetch('/api/live',{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error(T('Direct indisponible'));
  liveState=await r.json();
 }catch{liveState=null;}
 finally{liveBusy=false;}
 if($('slot').value!=='latest')return;
 if(previousQuests!==JSON.stringify(currentQuests()))renderQuests();
 if(applyCollectibleState()||previousTokens!==currentSkulltulas()){renderList();if(selected)showDetail(catalog.find(x=>x.id===selected));}
 const area=currentArea(),player=currentPlayer();
 if(mapMode==='world'){if(area!==lastLiveArea)draw();}
 else if(!$('carte').hidden){
  const follow=$('follow-player').checked&&player?.source==='live';
  const targetPlan=planForPlayer();
  if(follow&&(area!==lastLiveArea||targetPlan&&targetPlan.id!==$('plan').value)){
   if(targetPlan&&targetPlan.id.split('/')[5]===$('region').value){
    const interiorChanged=Boolean(plans.find(p=>p.id===$('plan').value)?.interior)!==Boolean(targetPlan.interior);
    $('plan').value=targetPlan.id;if(interiorChanged)fit();syncPickers();renderList();
   }
   else alignMapWithSave();
  }
  const p=plans.find(p=>p.id===$('plan').value),visible=p&&playerOnPlan(p);
  if(follow&&visible){
   const r=$('map').getBoundingClientRect(),x=r.width/2-visible.position[0]*scale,y=r.height/2-visible.position[2]*scale;
   if(Math.abs(x-ox)>.1||Math.abs(y-oy)>.1){ox=x;oy=y;pan();}
  }
  if(p){const world=$('world');world.querySelector('.player-marker')?.remove();drawPlayerMarker(world,p);}
 }
 lastLiveArea=area;
}
setInterval(refreshLive,200);

async function openOverlay(){
 const buttons=[...document.querySelectorAll('[data-open-overlay]')];
 buttons.forEach(b=>b.disabled=true);
 try{
  const response=await fetch('/api/overlay/open',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const result=await response.json();if(!response.ok)throw Error(result.error||T('Ouverture impossible'));
  $('overlay-status').textContent=T('Mini-carte ouverte. Elle reste au-dessus du jeu.');
 }catch(error){$('overlay-status').textContent=error.message;$('error').textContent=error.message;$('error').hidden=false;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
document.querySelectorAll('[data-open-overlay]').forEach(b=>b.onclick=openOverlay);
if(overlayMode){$('player-center').textContent=T('Recentrer');$('status-filter').value='missing';}
// Progress dial: main-story steps as a gold arc, the six medallions as points on the ring.
function renderDial(done,total){
 const medals=[['Light',T('Médaillon de la Lumière')],['Forest',T('Médaillon de la Forêt')],['Fire',T('Médaillon du Feu')],['Water',T('Médaillon de l’Eau')],['Shadow',T('Médaillon de l’Ombre')],['Spirit',T('Médaillon de l’Esprit')]];
 const owned=id=>(state?.inventory||[]).some(x=>x.id==='Item_Medal_'+id&&x.count>0);
 const radius=78,length=2*Math.PI*radius,share=total?Math.min(1,done/total):0;
 const points=medals.map(([id,name],i)=>{const a=i*Math.PI/3,lit=owned(id);return `<circle class="dial-medal${lit?' lit':''}" cx="${(100+radius*Math.sin(a)).toFixed(1)}" cy="${(100-radius*Math.cos(a)).toFixed(1)}" r="10"><title>${name}${lit?T(' · obtenu'):T(' · à obtenir')}</title></circle>`;}).join('');
 const svg=`<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="dial-track" cx="100" cy="100" r="${radius}"/><circle class="dial-inner" cx="100" cy="100" r="56"/><circle class="dial-arc" cx="100" cy="100" r="${radius}" transform="rotate(-90 100 100)" stroke-dasharray="${length.toFixed(1)}" stroke-dashoffset="${(length*(1-share)).toFixed(1)}"/>${points}<text class="dial-count" x="100" y="106" text-anchor="middle">${Number(done)}</text><text class="dial-label" x="100" y="130" text-anchor="middle">${T('sur ')}${Number(total)}${T(' étapes')}</text></svg>`;
 for(const id of ['dial-home','dial-quests']){const box=$(id);if(!box)continue;box.innerHTML=svg;box.setAttribute('aria-label',T('Progression de l’histoire')+' : '+done+' / '+total+' · '+medals.filter(m=>owned(m[0])).map(m=>m[1]).join(', '));}
}
// Update notice: the server asks GitHub for the latest release at launch.
async function checkUpdate(attempt=0){
 if(overlayMode)return;
 let info;try{info=await (await fetch('/api/update',{signal:AbortSignal.timeout(5000)})).json();}catch{return;}
 if(info.status==='checking'&&attempt<5){setTimeout(()=>checkUpdate(attempt+1),3000);return;}
 let skipped='';try{skipped=localStorage.getItem('navi-update-skip')||'';}catch{}
 if(!info.available||skipped===info.latest)return;
 const banner=$('update-banner'),text=node('span',T('Navi ')+info.latest+T(' est disponible (tu as la ')+info.current+').'),actions=node('span','','update-actions');
 const later=node('button',T('Plus tard'));later.onclick=()=>{try{localStorage.setItem('navi-update-skip',info.latest);}catch{}banner.hidden=true;};
 if(info.canInstall){
  const go=node('button',T('Mettre à jour'),'primary');
  go.onclick=async()=>{
   go.disabled=later.disabled=true;text.textContent=T('Mise à jour en cours… Navi va redémarrer tout seul.');
   try{
    const r=await fetch('/api/update/install',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'erreur '+r.status);
    const wait=setInterval(async()=>{try{const now=await (await fetch('/api/update',{signal:AbortSignal.timeout(2500)})).json();if(now.current===info.latest){clearInterval(wait);location.reload();}}catch{}},2500);
   }catch(e){text.textContent=T(e.message);go.disabled=later.disabled=false;}
  };
  actions.append(go);
 }else if(/^https:\/\/github\.com\//.test(info.url||'')){
  const link=node('a',T('Voir la version'));link.href=info.url;link.target='_blank';link.rel='noopener';actions.append(link);
 }
 actions.append(later);banner.replaceChildren(text,actions);banner.hidden=false;
}
