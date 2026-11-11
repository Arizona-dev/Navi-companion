const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=readFileSync(join(__dirname,'..','web','app.js'),'utf8');
// Run the actual state-merging and overlay visibility functions without a DOM.
const functions=source.slice(source.indexOf('function currentSkulltulas(){'),source.indexOf('function filtered(){'));
const ui={slot:{value:'latest'}};
const context=vm.createContext({$:id=>ui[id],state:{skulltulas:25,collectibles:{items:[{id:'heart',owned:false},{id:'skull',owned:true}]}},liveState:{connected:true,skulltulas:26,collectibles:{items:[{id:'heart',owned:true}]}},catalog:[{id:'heart'},{id:'skull'}]});
vm.runInContext(functions,context);
assert.equal(context.applyCollectibleState(),true);
assert.equal(context.catalog[0].owned,true); // An unsaved reward disappears.
assert.equal(context.catalog[1].owned,true); // Live partial data preserves save-only skulls.
assert.equal(context.applyCollectibleState(),false);
ui.slot.value='slot_01';
context.applyCollectibleState();
assert.equal(context.catalog[0].owned,false); // Historical slots cannot borrow the current game.
assert.equal(context.currentSkulltulas(),25);
ui.slot.value='latest'; context.liveState.connected=false;
context.applyCollectibleState(); assert.equal(context.catalog[0].owned,false);
const reward={owned:false,requirements:[{condition:'tokens50'}]};
assert.equal(context.overlayCollectibleVisible(reward,25),false);
assert.equal(context.overlayCollectibleVisible(reward,50),true);
assert.equal(context.overlayCollectibleVisible({...reward,owned:true},50),false);
assert.equal(context.overlayCollectibleVisible({...reward,owned:null},50),false);
assert.equal(context.overlayCollectibleVisible({owned:false},25),true);
console.log('Collectible merge, slot isolation and overlay prerequisite checks passed.');
