import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, mkdir, cp, symlink, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { patch } from '../scripts/patch.mjs';
import extension from '../src/index.js';

const installed = process.env.PI_PAUSE_NODE_MODULES;
if (!installed) throw new Error('Set PI_PAUSE_NODE_MODULES to the Pi 1.3.0 runtime node_modules directory');
const sandbox = await mkdtemp(join(tmpdir(), 'pi-pause-'));
after(() => rm(sandbox, { recursive: true, force: true }));
const modules = join(sandbox, 'node_modules');
const scope = join(modules, '@earendil-works');
await mkdir(scope, { recursive: true });
for (const name of await readdir(installed)) {
  if (name !== '@earendil-works') await symlink(resolve(installed, name), join(modules, name));
}
for (const name of await readdir(join(installed, '@earendil-works'))) {
  if (name.startsWith('.')) continue;
  const from = join(installed, '@earendil-works', name), to = join(scope, name);
  if (['pi-coding-agent', 'pi-agent-core'].includes(name)) await cp(from, to, { recursive: true, dereference: true });
  else await symlink(resolve(from), to);
}
// A deployed runtime is also a valid test source: restore only the sandbox copy.
const hostBackup = join(installed, '@earendil-works/.pi-pause-backup');
const hasBackup = await readFile(join(hostBackup, 'manifest.json')).then(() => true, error => {
  if (error.code !== 'ENOENT') throw error;
  return false;
});
if (hasBackup) {
  await cp(hostBackup, join(scope, '.pi-pause-backup'), { recursive: true });
  await patch(scope, { restore: true });
}
const originalLoop = await readFile(join(scope, 'pi-agent-core/dist/agent-loop.js'), 'utf8');
assert.match(await patch(scope, { check: true }), /Validated/);
await patch(scope);
const sdk = await import(pathToFileURL(join(scope, 'pi-coding-agent/dist/index.js')));
const ai = await import(pathToFileURL(join(scope, 'pi-ai/dist/index.js')));
const { createAgentSession, createCodemodeExtension, DefaultResourceLoader, SessionManager, SettingsManager } = sdk;
const model = { id:'pause-test', name:'pause-test', api:'openai-completions', provider:'pause-test', baseUrl:'http://unused.invalid', reasoning:false, input:['text'], contextWindow:100000, maxTokens:1000, cost:{input:0,output:0,cacheRead:0,cacheWrite:0} };
const gate = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const toolCall = (name = 'hold', id = name) => ({ type:'toolCall', name, id, arguments:{} });

async function fixture(t, respond, extensions = [], settings = {}) {
  const cwd = await mkdtemp(join(sandbox, 'session-'));
  const settingsManager = SettingsManager.inMemory({ compaction:{enabled:false}, retry:{enabled:false}, ...settings });
  let api;
  const loader = new DefaultResourceLoader({ cwd, agentDir:join(cwd,'agent'), settingsManager, noExtensions:true, noSkills:true, noContextFiles:true, extensionFactories:[extension, ...extensions, pi => { api = pi; pi.registerProvider(model.provider,{apiKey:'dummy',api:model.api,baseUrl:model.baseUrl,models:[model]}); }] });
  await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
  const sm = SessionManager.inMemory(cwd);
  const {session} = await createAgentSession({cwd,agentDir:join(cwd,'agent'),settingsManager,resourceLoader:loader,sessionManager:sm,model});
  const errors = [], events = [], requests = [];
  await session.bindExtensions({onError:error => errors.push(error)});
  session.subscribe(event => events.push(event));
  session.agent.streamFunction = (_model, context, options) => {
    requests.push(structuredClone(context));
    assert.ok(requests.length < 10, 'Unexpected continuation');
    const stream = ai.createAssistantMessageEventStream();
    void (async () => {
      const response = await respond(requests.length, context, options);
      const message = {role:'assistant',content:response.content ?? [{type:'text',text:'done'}],api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:response.error?'error':response.content?'toolUse':'stop',timestamp:Date.now(),...(response.error?{errorMessage:response.error}:{})};
      stream.push(response.error?{type:'error',reason:'error',error:message}:{type:'done',reason:message.stopReason,message});
      stream.end();
    })().catch(error => { stream.end(); errors.push(error); });
    return stream;
  };
  t.after(() => {session.dispose(); assert.deepEqual(errors, []);});
  return {session,api,sm,events,requests};
}
function hold(pi, entered, release, signals, name = 'hold') {
  pi.registerTool({ name, label:name, description:'test barrier', parameters:{type:'object',properties:{}}, async execute(_id,_args,signal) {
    signals.push(signal); entered.resolve(); await release.promise;
    return {content:[{type:'text',text:name+' finished'}],details:undefined};
  }});
}

test('idle and unsupported hosts: no messages, no tools', async () => {
  let command; const notices = [];
  extension({registerCommand:(name, value) => {assert.equal(name,'pause');command=value;}});
  await command.handler('',{ui:{notify:(...args)=>notices.push(args)}});
  assert.equal(notices[0][1],'error');
  await command.handler('',{requestPause:()=>false,ui:{notify:(...args)=>notices.push(args)}});
  assert.equal(notices[1][0],'Already idle.');
});

test('model finishes, no pause message or aborted assistant, next user input resumes', async t => {
  const entered=gate(),release=gate(); t.after(()=>release.resolve());
  const h=await fixture(t,async n=>{if(n===1){entered.resolve();await release.promise;}return {};});
  assert.equal(h.session.requestPause(),false);
  const running=h.session.prompt('start'); await entered.promise;
  const prefix=structuredClone(h.session.messages);
  await h.session.prompt('/pause');
  assert.deepEqual(h.session.messages,prefix);
  release.resolve(); await running;
  assert.equal(h.requests.length,1);
  assert.equal(h.events.at(-1).type,'agent_settled');
  assert.equal(h.events.at(-1).paused,true); assert.equal(h.events.at(-1).aborted,false);
  const completed=structuredClone(h.session.messages);
  assert.equal(completed.at(-1).stopReason,'stop');
  await h.session.prompt('continue');
  assert.equal(h.requests.length,2);
  assert.deepEqual(h.requests[1].messages.slice(0,completed.length),completed);
  assert.equal(h.events.at(-1).paused,false);
});

test('whole tool batch finishes, queues and extension continuation cannot restart it', async t => {
  const entered=gate(),release=gate(),signals=[]; t.after(()=>release.resolve());
  const h=await fixture(t,n=>n===1?{content:[toolCall('hold','a'),toolCall('hold','b')]}:{},[
    pi=>{hold(pi,entered,release,signals); pi.on('turn_end',()=>({continue:true}));},
  ]);
  const running=h.session.prompt('start'); await entered.promise;
  await h.session.steer('queued steering'); await h.session.followUp('queued follow-up');
  await h.session.prompt('/pause'); await h.session.prompt('/pause');
  assert.equal(signals.some(s=>s?.aborted),false);
  release.resolve(); await running;
  assert.equal(h.requests.length,1);
  assert.equal(h.sm.getBranch().filter(e=>e.type==='message'&&e.message.role==='toolResult').length,2);
  assert.deepEqual(h.session.getSteeringMessages(),['queued steering']);
  assert.deepEqual(h.session.getFollowUpMessages(),['queued follow-up']);
  assert.equal(signals.length,2); assert.equal(signals.some(s=>s?.aborted),false);
});

test('nested codemode work finishes without cancellation', async t => {
  const entered=gate(),release=gate(),signals=[]; t.after(()=>release.resolve());
  const h=await fixture(t,()=>({content:[{type:'toolCall',name:'codemode',id:'code',arguments:{code:'text(await tools.hold({}));'}}]}),[
    createCodemodeExtension({models:false}),pi=>hold(pi,entered,release,signals),
  ]);
  h.api.setActiveTools(['codemode', 'hold']);
  const running=h.session.prompt('nested work'); await entered.promise;
  await h.session.prompt('/pause'); release.resolve(); await running;
  assert.equal(h.requests.length,1); assert.equal(signals[0]?.aborted,false);
  const result=h.session.messages.find(m=>m.role==='toolResult');
  assert.equal(result.toolName,'codemode'); assert.notEqual(result.isError,true);
  assert.match(JSON.stringify(result.content),/hold finished/);
});

test('pause from turn_end observer is rechecked after finishTurn decision', async t => {
  const h=await fixture(t,()=>({content:[toolCall()]}),[pi=>pi.registerTool({name:'hold',label:'hold',description:'instant',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'ok'}],details:undefined};}})]);
  h.session.subscribe(event=>{if(event.type==='turn_end')h.session.requestPause();});
  await h.session.prompt('start'); assert.equal(h.requests.length,1);
});

test('paused settlement and later extension messages stay queued', async t => {
  const entered=gate(),release=gate();t.after(()=>release.resolve());
  const h=await fixture(t,async()=>{entered.resolve();await release.promise;return {};},[
    pi=>pi.on('agent_settled',()=>{
      pi.sendUserMessage('extension user continuation');
      pi.sendMessage({customType:'retry',content:'extension custom continuation',display:false},{triggerTurn:true});
    }),
  ]);
  const running=h.session.prompt('start');await entered.promise;
  h.session.requestPause();release.resolve();await running;
  assert.equal(h.requests.length,1);
  assert.equal(h.session.agent.hasQueuedMessages(),true);
  assert.doesNotMatch(JSON.stringify(h.session.messages),/extension .* continuation/);
  await h.session.sendUserMessage('later extension');
  assert.equal(h.requests.length,1);
});

test('error retry is suppressed, original error remains intact',async t=>{
  const entered=gate(),release=gate();t.after(()=>release.resolve());
  const h=await fixture(t,async()=>{entered.resolve();await release.promise;return {error:'429 rate limit'};},[],{retry:{enabled:true,maxRetries:2,baseDelayMs:1}});
  const running=h.session.prompt('start');await entered.promise;
  h.session.requestPause();release.resolve();await running;
  assert.equal(h.requests.length,1);
  assert.equal(h.session.messages.at(-1).stopReason,'error');
  assert.equal(h.events.find(e=>e.type==='agent_end').willRetry,false);
});

test('pause during next-request preparation does not issue another request', async t => {
  const entered=gate(),release=gate();t.after(()=>release.resolve());
  const h=await fixture(t,()=>({content:[toolCall()]}),[pi=>pi.registerTool({name:'hold',label:'hold',description:'instant',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'ok'}],details:undefined};}})]);
  const previous=h.session.agent.prepareNextTurnWithContext;
  h.session.agent.prepareNextTurnWithContext=async(...args)=>{entered.resolve();await release.promise;return previous?.(...args);};
  const running=h.session.prompt('start');await entered.promise;
  h.session.requestPause();release.resolve();await running;
  assert.equal(h.requests.length,1);
  assert.equal(h.session.messages.at(-1).role,'toolResult');
});

test('pause during final continuation hook suppresses continuation', async t => {
  const entered=gate(),release=gate();t.after(()=>release.resolve());
  const h=await fixture(t,()=>({}),[pi=>pi.on('agent_before_settle',async()=>{entered.resolve();await release.promise;return {continue:true};})]);
  const running=h.session.prompt('start');await entered.promise;
  h.session.requestPause();release.resolve();await running;
  assert.equal(h.requests.length,1);assert.equal(h.events.at(-1).paused,true);
});

test('resuming preserves tool results as prefix and does not repeat tools',async t=>{
  const entered=gate(),release=gate(),signals=[];t.after(()=>release.resolve());
  const h=await fixture(t,n=>n===1?{content:[toolCall()]}:{},[pi=>hold(pi,entered,release,signals)]);
  const running=h.session.prompt('start');await entered.promise;
  h.session.requestPause();release.resolve();await running;
  const prefix=structuredClone(h.session.messages);
  await h.session.prompt('continue');
  assert.equal(h.requests.length,2);assert.equal(signals.length,1);
  assert.deepEqual(h.requests[1].messages.slice(0,prefix.length),prefix);
});

test('pause while run starts is safe and does not call the provider',async t=>{
  const entered=gate(),release=gate();t.after(()=>release.resolve());
  const h=await fixture(t,()=>({}),[pi=>pi.on('before_agent_start',async()=>{entered.resolve();await release.promise;})]);
  const running=h.session.prompt('start');await entered.promise;
  h.session.requestPause();release.resolve();await running;
  assert.equal(h.requests.length,0);
  assert.equal(h.session.messages.some(m=>m.role==='assistant'),false);
});

test('patch is idempotent and restore preserves exact originals',async()=>{
  assert.equal(await patch(scope),'Already patched');
  const file=join(scope,'pi-agent-core/dist/agent-loop.js');
  const patched=await readFile(file,'utf8');
  await writeFile(file,patched+'\n// local edit\n');
  await assert.rejects(()=>patch(scope,{restore:true}),/Refusing/);
  await writeFile(file,patched);
  await patch(scope,{restore:true});
  assert.equal(await readFile(file,'utf8'),originalLoop);
  await patch(scope);
});
