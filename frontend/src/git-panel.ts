import { readGitAiPreferences } from "./git-ai-preferences";
export interface GitAiModel { configId: string; name: string; model: string; isDefault: boolean }
interface GitChange { path: string; index: string; working: string }
interface GitState { state: string; branch: string; revision: string; changes: GitChange[] }
interface GitWorkspace { workspaceId: string; singleFile?: boolean }
interface Options {
 workspace: () => GitWorkspace | null;
 zh: () => boolean;
 invoke: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
 changed: () => void;
 openDiff: (path: string, staged: boolean) => void;
 showSidebar: () => void;
 hasUnsaved: () => boolean;
 diskChanged: () => Promise<void>;
 loadAIPreferences?: () => Promise<unknown>;
 saveAIPreferences?: (value: unknown) => Promise<void>;
 providersAI?: () => Promise<{ configId: string; name: string }[] | null>;
 discoverAI?: (id: string) => Promise<GitAiModel[]>;
 listAI: () => Promise<GitAiModel[] | null>;
 openAI: (context: Record<string, unknown>, model?: GitAiModel) => Promise<string | void>;

}

export function createGitPanel(options: Options) {
 let state: GitState | null = null;
 let generation = 0;
 let pending = false;
 let operating = false;
 let actionMessage = "";
 const commitDrafts = new Map<string, string>();
 let previousID: string | undefined;
 let error = "";
 let selected = "";
 const text = (zh: string, en: string) => options.zh() ? zh : en;
 const button = document.createElement("button");
 button.type = "button"; button.className = "status-language git-status";
 document.querySelector(".status-left")!.prepend(button);
 const explorer = document.getElementById("explorer")!;
 const switcher = document.createElement("nav");
 switcher.className = "activity-bar";
 const filesButton = document.createElement("button");
 const gitButton = document.createElement("button");
 filesButton.type = gitButton.type = "button";
 filesButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l4 4v13H8zM16 3v5h4M5 7H3v15h13"/></svg>`;
 gitButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="3"/><circle cx="6" cy="19" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 8v8M18 9v2a5 5 0 0 1-5 5H6"/></svg>`;
 const countBadge = document.createElement("span"); countBadge.className = "activity-count"; countBadge.setAttribute("aria-hidden", "true"); gitButton.append(countBadge);
 switcher.append(filesButton, gitButton); document.getElementById("workspace-layout")!.prepend(switcher);
 const panel = document.createElement("section");
 panel.className = "git-sidebar"; panel.hidden = true;
 panel.innerHTML = `<header class="panel-heading"><strong class="git-title panel-label"></strong><div class="panel-actions"><button type="button" class="git-refresh icon-button"></button><button type="button" class="git-actions icon-button" aria-haspopup="menu" aria-expanded="false"></button></div><div class="git-menu menu-popover" role="menu" hidden></div></header><button type="button" class="git-branch"></button><div class="git-tools"></div><section class="git-details" hidden></section><div class="git-commit-area"><textarea class="git-message" rows="3" maxlength="4000"></textarea><div class="git-commit-actions"><button type="button" class="git-commit primary-button"></button></div><div class="git-commit-guidance"><span></span><button type="button" class="git-stage-before-commit ghost-button"></button></div><p class="git-action-message" role="status"></p></div><p class="git-hint"></p><nav class="git-files"></nav>`;
 explorer.append(panel);
 const node = <T extends HTMLElement>(selector: string) => panel.querySelector<T>(selector)!;
 const messageInput = node<HTMLTextAreaElement>(".git-message");
 messageInput.oninput = () => { const id = options.workspace()?.workspaceId; if (id) commitDrafts.set(id, messageInput.value); updateCommit(); };
 messageInput.onkeydown = event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {event.preventDefault(); void mutate("commit");} };
 node(".git-stage-before-commit").onclick = () => {void mutate("stageAll");};
 node(".git-commit").onclick = () => {void mutate("commit");};
 const icon = (paths: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
 node(".git-refresh").innerHTML = icon('<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/>');
 node(".git-actions").innerHTML = icon('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>');
 function closeMenu() { node(".git-menu").hidden = true; node(".git-actions").setAttribute("aria-expanded", "false"); }
 node(".git-actions").onclick = () => {
  const menu = node(".git-menu"); menu.hidden = !menu.hidden;
  node(".git-actions").setAttribute("aria-expanded", String(!menu.hidden));
  if (!menu.hidden) menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
 };
 document.addEventListener("pointerdown", event => { if (!panel.querySelector("header")!.contains(event.target as Node)) closeMenu(); });
 node(".git-menu").onkeydown = event => {
  if (event.key === "Escape") {closeMenu(); node(".git-actions").focus();}
  const items = Array.from(node(".git-menu").querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
   event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
   items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }
 };
 let detailsMode = "";
 let selectedAI: GitAiModel | undefined;
 let aiPreferences = readGitAiPreferences(null);
 let preferencesLoaded = false;
 let saveQueue = Promise.resolve();
 const rememberAI = (provider: string, model: string) => {
  aiPreferences.provider = provider; aiPreferences.models[provider] = model;
  const snapshot = { provider, models: { ...aiPreferences.models } };
  saveQueue = saveQueue.then(async () => { await options.saveAIPreferences?.(snapshot); }).catch(() => {
   actionMessage = text("AI 选择保存失败，重开插件后可能丢失。", "Could not save AI selection; it may be lost on reopening."); render();
  });
 };
 const actions: [string,string,string,string][] = [
  ["ai", "AI 提交说明", "AI commit message", '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>'],
  ["fetch", "获取远程更新", "Fetch", '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'],
  ["pull", "拉取（仅快进）", "Pull (fast-forward only)", '<path d="M12 3v16m-6-6 6 6 6-6"/>'],
  ["push", "推送", "Push", '<path d="M12 21V5m-6 6 6-6 6 6"/>'],
  ["sync", "同步（拉取后推送）", "Sync (pull then push)", '<path d="M3 8h17l-4-4M21 16H4l4 4"/>'],
  ["history", "提交历史", "Commit history", '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>']
 ];
 const actionHelp: Record<string,[string,string]> = {
  ai:["AI 提交说明：选择 DBX 已配置的模型生成并回填；旧宿主打开 AI 对话。","AI commit message: choose a DBX model to generate and fill the message; older hosts open AI chat."],
  fetch:["获取远程更新：下载上游提交，不修改工作区文件。","Fetch: download upstream commits without changing working files."],
  pull:["拉取：获取上游更新并快进本地分支；请先保存并提交更改。","Pull: fetch and fast-forward your branch. Save and commit changes first."],
  push:["推送：把本地提交上传到已配置的上游分支，不会强制覆盖远程。","Push: upload local commits to the configured upstream without force-pushing."],
  sync:["同步：先拉取上游更新，再推送本地提交；拉取失败时停止。","Sync: pull upstream updates, then push local commits. Stops if pull fails."],
  history:["提交历史：展开或收起当前分支最近 30 条提交。","History: show or hide the latest 30 commits on this branch."]
 };
 for (const [action,zh,en,svg] of actions) {
  const control = document.createElement("button"); control.type="button"; control.className="icon-button"; control.innerHTML=icon(svg);
  control.dataset.action=action; control.title=text(zh,en); control.setAttribute("aria-label",control.title);
  control.onclick=()=>{void dispatch(action);}; node(".git-tools").append(control);
 }
 node(".git-branch").onclick=()=>{void showDetails("branches");};
 async function showDetails(mode: string) {
  const current=options.workspace(); if (!current || operating) return;
  const box=node(".git-details"); if (detailsMode===mode && !box.hidden) {box.hidden=true;detailsMode="";return;}
  detailsMode=mode;box.hidden=false;box.textContent=text("加载中…","Loading…");
  try {
   const info=await options.invoke<{branches:string[];history:{hash:string;subject:string;date:string}[]}>("git/info",{workspaceId:current.workspaceId});
   if(current.workspaceId!==options.workspace()?.workspaceId || detailsMode!==mode)return;
   box.replaceChildren();
   const heading=document.createElement("strong");heading.className="explorer-section-label";heading.textContent=mode==="branches"?text("切换本地分支","Switch local branch"):text("最近 30 条提交","Latest 30 commits");box.append(heading);
   if(mode==="branches") {
    const form=document.createElement("form");form.className="git-create-branch";
    const label=document.createElement("label");label.textContent=text("从当前 HEAD 新建分支","New branch from current HEAD");
    const input=document.createElement("input");input.type="text";input.placeholder="feature/my-change";input.maxLength=200;input.required=true;input.setAttribute("aria-label",text("新分支名称","New branch name"));label.append(input);
    const create=document.createElement("button");create.type="submit";create.className="primary-button";create.textContent=text("新建并切换","Create and switch");create.dataset.tooltip=text("从当前提交创建本地分支并切换；不会自动推送到远程。","Create a local branch at the current commit and switch to it. Does not push.");
    form.append(label,create);form.onsubmit=event=>{event.preventDefault();void mutate("createBranch",input.value.trim());};box.append(form);
   }
   if(mode==="branches") for(const branch of info.branches){const item=document.createElement("button");item.className="menu-item";item.type="button";item.textContent=branch;item.disabled=branch===state?.branch;item.onclick=()=>{void mutate("switch",branch);};box.append(item);}
   else for(const commit of info.history){const item=document.createElement("div");item.className="git-history-item";const title=document.createElement("span");title.textContent=commit.subject;const meta=document.createElement("small");meta.textContent=commit.hash+" · "+commit.date;item.append(title,meta);box.append(item);}
   if(!(mode==="branches"?info.branches:info.history).length)box.append(document.createTextNode(text("暂无记录","No entries")));
  }catch(err){box.textContent=String(err instanceof Error?err.message:err);}
 }
 async function dispatch(action:string) {
  if(action==="history" || action==="branches"){await showDetails(action);return;}
  if(action!=="ai" && action!=="aiGenerate"){await mutate(action);return;}
  if(action==="ai") {
   if(operating)return;
   if(detailsMode === "ai" && !node(".git-details").hidden) {
    node(".git-details").hidden = true; detailsMode = ""; render(); return;
   }
   operating=true;render();
   try {
    if (!preferencesLoaded) {
     try { aiPreferences = readGitAiPreferences(await options.loadAIPreferences?.()); preferencesLoaded = true; }
     catch { actionMessage = text("无法读取上次 AI 选择。", "Could not load the previous AI selection."); }
    }
    const providers = await options.providersAI?.();
    if (providers) {
     const box=node(".git-details");detailsMode="ai";box.hidden=false;box.replaceChildren();
     const label=document.createElement("label");label.className="git-ai-picker";label.textContent=text("AI 供应商","AI provider");
     const provider=document.createElement("select");provider.setAttribute("aria-label",label.textContent);
     for(const p of providers){const option=document.createElement("option");option.value=p.configId;option.textContent=p.name;provider.append(option);}
     if(providers.some(p=>p.configId===aiPreferences.provider))provider.value=aiPreferences.provider;
     label.append(provider);box.append(label);
     const modelLabel=document.createElement("label");modelLabel.className="git-ai-picker";modelLabel.textContent=text("模型（可搜索或输入 ID）","Model (search or enter ID)");
     const input=document.createElement("input");input.maxLength=256;input.setAttribute("aria-label",modelLabel.textContent);input.setAttribute("list","git-ai-model-options");
     const list=document.createElement("datalist");list.id="git-ai-model-options";
     input.value=aiPreferences.models[provider.value] ?? "";
     modelLabel.append(input,list);box.append(modelLabel);
     const reload=document.createElement("button");reload.type="button";reload.textContent=text("刷新模型列表","Refresh models");box.append(reload);
     const note=document.createElement("p");note.className="git-hint";box.append(note);
     const generate=document.createElement("button");generate.type="button";generate.className="primary-button git-ai-generate";generate.textContent=text("生成提交说明","Generate commit message");generate.onclick=()=>{void dispatch("aiGenerate");};box.append(generate);
     const update=()=>{const p=providers.find(p=>p.configId===provider.value);selectedAI=p && input.value.trim()?{...p,model:input.value.trim(),isDefault:false}:undefined;generate.disabled=!selectedAI || operating;};
     let request=0;
     const refreshModels=async()=>{
      const ticket=++request;const id=provider.value;list.replaceChildren();note.textContent=text("正在获取模型…","Fetching models…");reload.disabled=true;
      try {
       const models=await options.discoverAI!(id);
       if(ticket!==request || !box.contains(input))return;
       for(const m of models){const option=document.createElement("option");option.value=m.model;list.append(option);}
       note.textContent=models.length?text("选择或输入模型 ID，仅用于本插件。","Choose or enter a model ID for this plugin."):text("供应商未返回模型，可手动输入 ID。","No models returned. Enter a model ID manually.");
      }catch{if(ticket===request && box.contains(input))note.textContent=text("无法获取模型列表，请手动输入模型 ID，或检查 DBX 中的供应商配置。","Could not fetch models. Enter a model ID or check the provider in DBX.");}
      finally{if(ticket===request)reload.disabled=false;}
     };
     input.oninput=()=>{update();rememberAI(provider.value,input.value.trim());};provider.onchange=()=>{input.value=aiPreferences.models[provider.value] ?? "";update();rememberAI(provider.value,input.value.trim());void refreshModels();};reload.onclick=()=>{void refreshModels();};update();
     if(providers.length)void refreshModels();else{note.textContent=text("请先在 DBX 添加 API 供应商。","Add an API provider in DBX first.");reload.disabled=true;}
     return;
    }
    const models=await options.listAI();
    if(models!==null) {
     const box=node(".git-details");detailsMode="ai";box.hidden=false;box.replaceChildren();
     const label=document.createElement("label");label.className="git-ai-picker";label.textContent=text("使用 DBX 的 AI 模型","Use a DBX AI model");
     const select=document.createElement("select");select.setAttribute("aria-label",label.textContent);
     models.forEach((model,index)=>{const item=document.createElement("option");item.value=String(index);item.textContent=model.name+" · "+model.model;select.append(item);});
     const preferred=models.findIndex(m=>m.configId===selectedAI?.configId && m.model===selectedAI?.model);
     select.value=String(preferred>=0?preferred:Math.max(0,models.findIndex(m=>m.isDefault)));
     selectedAI=models[Number(select.value)];select.onchange=()=>{selectedAI=models[Number(select.value)];};
     label.append(select);box.append(label);
     const generate=document.createElement("button");generate.type="button";generate.className="primary-button git-ai-generate";generate.textContent=text("生成提交说明","Generate commit message");generate.disabled=!models.length;generate.onclick=()=>{void dispatch("aiGenerate");};box.append(generate);
     const note=document.createElement("p");note.className="git-hint";note.textContent=models.length ? text("复用宿主配置；发送当前差异后回填，不会自动提交。","Uses host settings; sends current diffs and fills the message without committing.") : text("请先在 DBX 配置 API 模型。此功能暂不支持 CLI Agent。","Configure an API model in DBX first. CLI agents are not supported here.");box.append(note);
     return;
    }
    selectedAI=undefined;
   }catch(err){actionMessage=String(err instanceof Error?err.message:err);return;}finally{operating=false;render();}
  }
  const current=options.workspace();if(!current || operating || pending || !state)return;
  const stagedChanges=state.changes.filter(c=>c.index!==" " && c.index!=="?");
  const staged=stagedChanges.length>0;
  const changes=staged ? stagedChanges : state.changes.filter(c=>c.working!==" ");
  if(!changes.length){actionMessage=text("没有可供 AI 分析的更改。请先修改并保存文件。","No changes to analyze. Edit and save a file first.");render();return;}
  const aiRevision=state.revision; const aiBranch=state.branch;
  const originalDraft=messageInput.value; const requestedAI=selectedAI;
  actionMessage=staged ? text("正在准备已暂存差异…","Preparing staged changes…") : text("正在准备工作区差异（不含未保存内容）…","Preparing changes on disk (unsaved edits excluded)…");
  operating=true;render();
  try{
   const diffs: {path:string;diff:string;truncated?:boolean}[]=[]; let size=0;
   const omitted: string[]=[];
   for(const change of changes){
    if(size>=60000){omitted.push(change.path);continue;}
    try {
     const result=await options.invoke<{diff:string}>("git/diff",{workspaceId:current.workspaceId,path:change.path,staged});
     const limit=Math.min(8000,60000-size);const diff=result.diff.slice(0,limit);size+=diff.length;
     diffs.push({path:change.path,diff,truncated:result.diff.length>limit});
    }catch{omitted.push(change.path);}
   }
   if(!diffs.some(item=>item.diff))throw new Error(text("这些更改没有可读取的文本差异。","No readable text diffs are available for these changes."));
   if(current.workspaceId!==options.workspace()?.workspaceId)return;
   const latest=await options.invoke<GitState>("git/status",{workspaceId:current.workspaceId});
   if(latest.revision!==aiRevision)throw new Error(text("暂存内容已变化，请刷新后重试。","Staged changes changed; refresh and retry."));
   actionMessage=text("正在等待宿主确认并生成提交说明…","Waiting for host confirmation and generating…");render();
   const generated=await options.openAI({branch:aiBranch,changeSource:staged ? "staged" : "workingTree",changes:diffs,omittedFiles:omitted,partial:omitted.length>0 || diffs.some(item=>item.truncated)},requestedAI);
   if(current.workspaceId!==options.workspace()?.workspaceId)return;
   if(typeof generated==="string") {
    if(messageInput.value!==originalDraft) {
     const box=node(".git-details");box.hidden=false;box.replaceChildren();const result=document.createElement("textarea");result.readOnly=true;result.value=generated;result.rows=5;result.setAttribute("aria-label",text("AI 生成结果","AI result"));box.append(result);
     actionMessage=text("生成期间提交说明已被编辑，已保留草稿。可从上方复制 AI 结果。","Your draft changed during generation and was preserved. Copy the AI result above if needed.");return;
    }
    messageInput.value=generated.slice(0,4000);commitDrafts.set(current.workspaceId,messageInput.value);
    actionMessage=generated.length>4000 ? text("AI 结果超过 4000 字，已截取填入，请检查后提交。","AI result exceeded 4000 characters and was truncated. Review before committing.") : text("AI 提交说明已填入，请检查后提交。","AI message filled in. Review before committing.");return;
   }
   actionMessage=text("已交给 DBX AI。请在宿主面板检查内容后发送，再将结果复制到提交框。开发预览不运行模型。","Passed to DBX AI. Review and send in the host panel, then copy the result here. Dev preview does not run a model.");
  }catch(err){actionMessage=String(err instanceof Error?err.message:err);}finally{operating=false;render();}
 }
 function updateCommit() {
  const ready=state?.state==="ready";
  const staged=ready && state!.changes.some(c=>c.index!==" " && c.index!=="?");
  const working=ready && state!.changes.some(c=>c.working!==" ");
  node<HTMLButtonElement>(".git-commit").disabled=operating || pending || !ready || !messageInput.value.trim() || !staged;
  const guidance=node(".git-commit-guidance");guidance.hidden=!ready || operating;
  node(".git-commit-guidance span").textContent=!staged ? (working ? text("尚未暂存文件。先暂存，再提交。","No staged files. Stage changes before committing.") : text("没有可提交的更改。","No changes to commit.")) : !messageInput.value.trim() ? text("填写提交说明后即可提交。","Enter a commit message to continue.") : text("仅提交已暂存的更改，不会自动推送。","Commits staged changes only; does not push.");
  const stage=node<HTMLButtonElement>(".git-stage-before-commit");stage.hidden=Boolean(staged)||!working;stage.disabled=operating||pending;stage.textContent=text("全部暂存","Stage all");
 }
 async function mutate(action: string, path?: string) {
  const current = options.workspace(); if (!current || operating || pending || state?.state !== "ready") return;
  if ((action === "commit" || action === "commitPush") && node<HTMLButtonElement>(".git-commit").disabled) return;
  if (["pull","sync","switch","createBranch"].includes(action) && options.hasUnsaved()) {actionMessage=text("请先保存编辑器中的修改。","Save editor changes first.");render();return;}
  const revision = state.revision; const message = messageInput.value;
  operating = true; actionMessage = ""; render();
  try {
   await options.invoke("git/action", {workspaceId: current.workspaceId, action, path: path ?? "", revision, message: action.startsWith("commit") ? message : ""});
   if (action.startsWith("commit")) commitDrafts.delete(current.workspaceId);
   if (current.workspaceId === options.workspace()?.workspaceId) {
    if (action.startsWith("commit")) messageInput.value = "";
    actionMessage = action.startsWith("commit") ? text("提交操作完成。", "Commit operation completed.") : text("Git 操作完成。", "Git operation completed.");
    node(".git-details").hidden=true; detailsMode="";
    if (["pull","sync","switch","createBranch"].includes(action)) await options.diskChanged();
   }
  } catch (err) {
   if (current.workspaceId === options.workspace()?.workspaceId) actionMessage = String(err instanceof Error ? err.message : err);
  } finally { operating = false; await refresh(); }
 }
 const resetDiff = () => { selected = ""; };
 function showFiles() { options.showSidebar(); explorer.classList.remove("git-mode"); panel.hidden = true; render(); }
 function showGit() { options.showSidebar(); explorer.classList.add("git-mode"); panel.hidden = false; render(); void refresh(); }
 filesButton.onclick = showFiles; gitButton.onclick = showGit;
 const messages: Record<string, [string, string]> = {
  notRepository: ["请打开包含 .git 的仓库根目录。首版不扫描子仓库。", "Open a repository root containing .git. Nested repositories are not scanned."],
  folderRequired: ["请打开项目文件夹以查看 Git。", "Open a project folder to view Git."],
  linkedRepository: ["此仓库使用链接的 Git 元数据，首版暂不支持。", "Linked Git metadata / worktrees are not supported in this preview."],
  missingGit: ["未找到 Git，请安装 Git 后重启插件。", "Git was not found. Install Git and restart the plugin."],
  unavailable: ["无法读取 Git 元数据。", "Git metadata is unavailable."]
 };
 function render() {
  button.textContent = state?.state === "ready" ? `⑂ ${state.branch} · ${state.changes.length}` : "⑂ Git";
  button.title = text("Git 更改", "Git changes");
  button.disabled = !options.workspace();
  node(".git-refresh").title = pending ? text("刷新中…", "Refreshing…") : text("刷新", "Refresh");
  node(".git-refresh").setAttribute("aria-label", node(".git-refresh").title);
  node<HTMLButtonElement>(".git-refresh").disabled = pending || operating;
  node<HTMLElement>(".git-commit-area").hidden = state?.state !== "ready";
  messageInput.placeholder = text("提交说明（⌘/Ctrl+Enter 提交）", "Commit message (⌘/Ctrl+Enter)");
  messageInput.setAttribute("aria-label", text("提交说明", "Commit message")); messageInput.disabled = operating;
  node(".git-commit").textContent = operating ? text("处理中…", "Working…") : text("✓ 提交已暂存", "✓ Commit staged");
  node(".git-action-message").textContent = actionMessage;
  const trigger = node<HTMLButtonElement>(".git-actions"); trigger.disabled = operating || state?.state !== "ready";
  trigger.title = text("更多 Git 操作", "More Git actions"); trigger.setAttribute("aria-label", trigger.title);
  const menu = node(".git-menu");
  if (menu.hidden) {
   menu.replaceChildren(...[["stageAll", text("全部暂存", "Stage all")], ["unstageAll", text("全部取消暂存", "Unstage all")], ["commitPush", text("提交并推送", "Commit and push")], ["branches", text("切换分支", "Switch branch")]].map(([action,label]) => {
    const item = document.createElement("button"); item.type = "button"; item.className = "menu-item"; item.setAttribute("role", "menuitem"); item.textContent = label;
    item.onclick = () => {closeMenu(); trigger.focus(); void dispatch(action);}; return item;
   }));
  }
  menu.querySelectorAll<HTMLButtonElement>("button").forEach(item => {item.disabled = operating || pending;});
  node(".git-tools").hidden=state?.state!=="ready";
  node<HTMLButtonElement>(".git-branch").disabled=operating || pending;
  node(".git-branch").title=text("切换本地分支","Switch local branch");
  node(".git-tools").querySelectorAll<HTMLButtonElement>("button").forEach(control=>{control.disabled=operating || pending; const action=actions.find(a=>a[0]===control.dataset.action); if(action){control.dataset.tooltip=text(...actionHelp[action[0]]);control.title=text(action[1],action[2]);control.setAttribute("aria-label",control.title);}});
  node(".git-refresh").dataset.tooltip=text("刷新：重新读取磁盘上的 Git 状态，不会保存未保存的编辑。","Refresh Git status from disk; unsaved edits are not saved.");
  node(".git-actions").dataset.tooltip=text("更多操作：全部暂存、取消暂存、提交并推送、切换分支。","More actions: stage all, unstage all, commit and push, switch branches.");
  node(".git-branch").dataset.tooltip=text("新建或切换本地分支：请先保存编辑并提交或贮藏磁盘更改。","Create or switch local branch: save edits and commit or stash changes first.");
  node(".git-commit").dataset.tooltip=operating ? text("正在处理，请稍候。","Working, please wait.") : text("提交已暂存：需要先暂存文件并填写提交说明；仅创建本地提交，不会推送。快捷键 ⌘/Ctrl+Enter。","Commit staged: stage files and enter a message first. Creates a local commit without pushing. Shortcut: ⌘/Ctrl+Enter.");
  node(".git-details").querySelectorAll<HTMLInputElement|HTMLButtonElement>(".git-create-branch input, .git-create-branch button").forEach(control=>{control.disabled=operating || pending;});
  node(".git-details").querySelectorAll<HTMLSelectElement|HTMLButtonElement>(".git-ai-picker select, .git-ai-generate").forEach(control=>{control.disabled=operating || pending || (control.classList.contains("git-ai-generate") && !selectedAI);});
  const aiToggle = node<HTMLButtonElement>('.git-tools [data-action="ai"]');
  const aiExpanded = detailsMode === "ai" && !node(".git-details").hidden;
  aiToggle.setAttribute("aria-expanded", String(aiExpanded));
  aiToggle.title = aiExpanded ? text("收起 AI 提交说明", "Collapse AI commit message") : text("展开 AI 提交说明", "Expand AI commit message");
  aiToggle.setAttribute("aria-label", aiToggle.title);
  aiToggle.dataset.tooltip = aiToggle.title;
  updateCommit();
  switcher.setAttribute("aria-label", text("活动栏", "Activity bar"));
  filesButton.title = text("文件", "Files"); filesButton.setAttribute("aria-label", filesButton.title);
  const count = state?.state === "ready" ? state.changes.length : 0;
  gitButton.title = text("源代码管理", "Source Control"); gitButton.setAttribute("aria-label", gitButton.title);
  countBadge.textContent = count > 99 ? "99+" : String(count); countBadge.hidden = count === 0;
  gitButton.setAttribute("aria-description", text(`${count} 个更改`, `${count} changes`));
  filesButton.setAttribute("aria-pressed", String(panel.hidden));
  gitButton.setAttribute("aria-pressed", String(!panel.hidden));
  node(".git-title").textContent = text("源代码管理", "Source Control");
  node(".git-branch").textContent = state?.branch ?? "";
  const message = state && messages[state.state];
  node(".git-hint").textContent = error || (message ? text(...message) : text("显示磁盘上的修改 · 每 10 秒刷新 · 未保存的编辑不包含在内", "Changes on disk · Refreshes every 10 seconds · Unsaved edits are excluded"));
  const files = node(".git-files");
  files.setAttribute("aria-label", text("修改文件", "Changed files"));
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset.gitKey;
  files.replaceChildren();
  if (state?.state !== "ready") return;
  if (!state.changes.length) {files.textContent = text("工作区干净，没有更改。", "Working tree clean. No changes.");return;}
  for (const staged of [true, false]) {
   const changes = state.changes.filter(c => staged ? c.index !== " " && c.index !== "?" : c.working !== " ");
   if (!changes.length) continue;
   const title = document.createElement("h3"); title.textContent = `${staged ? text("已暂存", "Staged") : text("未暂存", "Working tree")} · ${changes.length}`; const group = document.createElement("div"); group.className = "git-group-heading";
   const allButton = document.createElement("button"); allButton.type = "button"; allButton.className = "icon-button"; allButton.innerHTML = icon(staged ? '<path d="M5 12h14"/>' : '<path d="M5 12h14M12 5v14"/>');
   allButton.title = staged ? text("全部取消暂存", "Unstage all") : text("全部暂存", "Stage all"); allButton.setAttribute("aria-label", allButton.title);
   allButton.disabled = operating || pending; allButton.onclick = () => {void mutate(staged ? "unstageAll" : "stageAll");};
   group.append(title,allButton); files.append(group);
   for (const change of changes) {
    const row = document.createElement("button"); row.type = "button";
    row.dataset.gitKey = `${staged}:${change.path}`;
    row.className = "git-file";
    row.classList.toggle("selected", selected === row.dataset.gitKey);
    row.title = change.path;
    const badge = document.createElement("b"); badge.className = "git-badge"; badge.textContent = staged ? change.index : change.working;
    const name = document.createElement("span"); name.textContent = change.path;
    row.append(badge, name); row.onclick = () => { selected = `${staged}:${change.path}`; render(); options.openDiff(change.path, staged); };
    const entry = document.createElement("div"); entry.className = "git-change-row";
    const action = document.createElement("button"); action.type = "button"; action.className = "git-stage-file icon-button";
    action.innerHTML = icon(staged ? '<path d="M5 12h14"/>' : '<path d="M5 12h14M12 5v14"/>'); action.title = (staged ? text("取消暂存", "Unstage") : text("暂存", "Stage")) + ": " + change.path;
    action.setAttribute("aria-label", action.title); action.disabled = operating || pending;
    action.onclick = () => {void mutate(staged ? "unstage" : "stage", change.path);};
    entry.append(row,action); files.append(entry);
    if (focusKey === row.dataset.gitKey) row.focus();
   }
  }
 }
 async function refresh() {
  const current = options.workspace();
  if (current?.workspaceId !== previousID) {
   previousID = current?.workspaceId; generation++; node(".git-details").hidden=true; detailsMode=""; pending = false; state = null; error = ""; actionMessage = ""; messageInput.value = commitDrafts.get(current?.workspaceId ?? "") ?? ""; resetDiff(); options.changed();
  }
  if (!current || pending || operating) {render();return;}
  const gen = generation; pending = true; render();
  try {
   const result = await options.invoke<GitState>("git/status", {workspaceId: current.workspaceId});
   if (gen !== generation || current.workspaceId !== options.workspace()?.workspaceId) return;
   const changed = JSON.stringify(state) !== JSON.stringify(result);
   state = result; error = ""; if (changed) options.changed();

  } catch (cause) {
   if (gen !== generation) return;
   state = null; options.changed();
   error = text("Git 状态读取失败：", "Could not read Git status: ") + String(cause && typeof cause === "object" && "message" in cause ? cause.message : cause);
  } finally {if (gen === generation) {pending = false;render();}}
 }
 button.onclick = showGit;
 node(".git-refresh").onclick = () => {void refresh();};
 window.addEventListener("focus", () => {void refresh();});
 document.addEventListener("visibilitychange", () => {if (!document.hidden) void refresh();});
 window.setInterval(() => {if (!document.hidden) void refresh();}, 10000);
 render();
 return {refresh, showFiles, status: (path: string) => {const c = state?.changes.find(c => c.path === path);return c ? (c.index + c.working).trim() : "";}};
}
