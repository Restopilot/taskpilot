import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase ───────────────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL  || "";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase  = SUPA_URL && SUPA_KEY ? createClient(SUPA_URL, SUPA_KEY) : null;

// ── Config ─────────────────────────────────────────────────────────────────────
const STATUSES = [
  { id:"todo",     label:"À faire",  clr:"#94a3b8" },
  { id:"progress", label:"En cours", clr:"#3b82f6" },
  { id:"blocked",  label:"Bloqué",   clr:"#f59e0b" },
  { id:"done",     label:"Terminé",  clr:"#10b981" },
];
const PRIORITIES = [
  { id:"low",      label:"Faible",   clr:"#10b981" },
  { id:"medium",   label:"Moyen",    clr:"#f59e0b" },
  { id:"high",     label:"Élevé",    clr:"#f97316" },
  { id:"critical", label:"Critique", clr:"#ef4444" },
];
const ENT_COLORS = ["#8b5cf6","#3b82f6","#f59e0b","#22c55e","#ec4899","#14b8a6","#f97316","#6366f1"];
const ICONS = [
  "🍽️","🍳","🧑‍🍳","🥂","🍷","☕","🛎️","🧾",
  "🏠","🏗️","🔑","📐","🏘️","🏢","💶","📝",
  "🎓","📚","🧑‍🏫","📋","✏️","🏆","🎯","💡",
  "👥","📊","💰","📱","🌐","⚙️","🔒","📦",
];
const INIT_ENTS = [
  { id:"e1", name:"Restaurant",   color:"#f59e0b", icon:"🍽️" },
  { id:"e2", name:"Immobilier",   color:"#3b82f6", icon:"🏠" },
  { id:"e3", name:"Formation",    color:"#8b5cf6", icon:"🎓" },
  { id:"e4", name:"Direction",    color:"#22c55e", icon:"💡" },
];

// ── DB Layer ───────────────────────────────────────────────────────────────────
const LS_KEY = "tp-v3";
function lsLoad() {
  try { const v=localStorage.getItem(LS_KEY); return v?JSON.parse(v):null; } catch { return null; }
}
function lsSave(d) {
  try { localStorage.setItem(LS_KEY,JSON.stringify(d)); } catch {}
}

async function dbLoadAll() {
  if (!supabase) {
    const d = lsLoad();
    return d || { entities: INIT_ENTS, tasks: [] };
  }
  const [{ data: ents }, { data: tsks }] = await Promise.all([
    supabase.from("entities").select("*").order("created_at"),
    supabase.from("tasks").select("*").order("created_at"),
  ]);
  const entities = (ents||[]).map(e => ({ id:e.id, name:e.name, color:e.color, icon:e.icon }));
  const tasks = (tsks||[]).map(t => ({
    id:t.id, entityId:t.entity_id, title:t.title, desc:t.description||"",
    status:t.status, priority:t.priority, dueDate:t.due_date||"",
    assignee:t.assignee||"", email:t.email||"",
    attachments:t.attachments||[], createdAt:new Date(t.created_at).getTime(),
  }));
  return { entities: entities.length ? entities : INIT_ENTS, tasks };
}

async function dbAddEntity(ent) {
  if (!supabase) return;
  await supabase.from("entities").insert({ id:ent.id, name:ent.name, color:ent.color, icon:ent.icon });
}
async function dbDeleteEntity(id) {
  if (!supabase) return;
  await supabase.from("entities").delete().eq("id", id);
}
async function dbUpsertTask(t) {
  if (!supabase) return;
  await supabase.from("tasks").upsert({
    id:t.id, entity_id:t.entityId, title:t.title, description:t.desc||"",
    status:t.status, priority:t.priority, due_date:t.dueDate||"",
    assignee:t.assignee||"", email:t.email||"", attachments:t.attachments||[],
  });
}
async function dbDeleteTask(id) {
  if (!supabase) return;
  await supabase.from("tasks").delete().eq("id", id);
}
async function dbUpdateTask(id, patch) {
  if (!supabase) return;
  const row = {};
  if (patch.status !== undefined)      row.status      = patch.status;
  if (patch.attachments !== undefined) row.attachments = patch.attachments;
  await supabase.from("tasks").update(row).eq("id", id);
}

// ── Storage upload ─────────────────────────────────────────────────────────────
async function uploadFile(file) {
  if (!supabase) return { id:uid(), name:file.name, size:file.size, type:file.type, url:null };
  const path = `${uid()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
  const { error } = await supabase.storage.from("attachments").upload(path, file);
  if (error) throw error;
  const { data:{ publicUrl } } = supabase.storage.from("attachments").getPublicUrl(path);
  return { id:uid(), name:file.name, size:file.size, type:file.type, url:publicUrl, path };
}

async function deleteFile(path) {
  if (!supabase || !path) return;
  await supabase.storage.from("attachments").remove([path]);
}

// ── Email via Resend ───────────────────────────────────────────────────────────
async function sendEmail(task, entity, toEmail, msg) {
  const st = STATUSES.find(s=>s.id===task.status)?.label||task.status;
  const pr = PRIORITIES.find(p=>p.id===task.priority)?.label||task.priority;
  const due = task.dueDate ? new Date(task.dueDate+"T00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"long",year:"numeric"}) : "Non définie";
  const body = `Bonjour,\n\nAlerte TaskPilot :\n\nTâche : ${task.title}\nEntité : ${entity?.name||"N/A"}\nPriorité : ${pr}\nStatut : ${st}\nÉchéance : ${due}\nAssigné à : ${task.assignee||"Non assigné"}${msg?"\n\nMessage : "+msg:""}\n\nCordialement,\nTaskPilot`;
  const res = await fetch("/api/send-email", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ to:toEmail, subject:`[TaskPilot] Alerte — ${task.title}`, body }),
  });
  if (!res.ok) { const d=await res.json(); throw new Error(d.error||"Erreur envoi"); }
  return res.json();
}

// ── Utils ──────────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2,9);
const initials = n => n?.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase()||"?";
const fmtDate = d => d ? new Date(d+"T00:00").toLocaleDateString("fr-FR",{day:"2-digit",month:"short"}) : "—";
const isOD = (d,s) => d && s!=="done" && new Date(d)<new Date();
const fileSz = b => b<1024?b+"o":b<1048576?Math.round(b/1024)+"Ko":(b/1048576).toFixed(1)+"Mo";
const fileIco = t => t?.startsWith("image")?"🖼️":t?.includes("pdf")?"📄":t?.includes("word")||t?.includes("document")?"📝":t?.includes("sheet")||t?.includes("excel")?"📊":"📎";

function useIsMobile() {
  const [m,sm]=useState(()=>window.innerWidth<768);
  useEffect(()=>{ const h=()=>sm(window.innerWidth<768); window.addEventListener("resize",h); return()=>window.removeEventListener("resize",h); },[]);
  return m;
}

// ── Theme ──────────────────────────────────────────────────────────────────────
const SB = { bg:"#16202e", hover:"#1d2c3e", active:"#1d2c3e", text:"#c8d8e8", muted:"#617d97", border:"#243447", accent:"#ffffff" };
function mkT(dark) {
  return dark ? { bg:"#111827", surf:"#1e293b", card:"#253347", card2:"#2c3d54", border:"#334155", border2:"#3d4f66", text:"#f1f5f9", sub:"#94a3b8", muted:"#64748b", green:"#10b981", red:"#ef4444", amber:"#f59e0b", blue:"#3b82f6", inputBg:"#1e293b" }
    : { bg:"#f0f4f8", surf:"#ffffff", card:"#ffffff", card2:"#f8fafc", border:"#e2e8f0", border2:"#cbd5e1", text:"#0f172a", sub:"#475569", muted:"#94a3b8", green:"#10b981", red:"#ef4444", amber:"#f59e0b", blue:"#3b82f6", inputBg:"#ffffff" };
}
const mkInp = (T,x={}) => ({width:"100%",background:T.inputBg,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,fontFamily:"Inter,sans-serif",fontSize:14,padding:"10px 12px",outline:"none",boxSizing:"border-box",...x});
const mkLbl = T => ({display:"block",fontSize:12,fontWeight:500,color:T.sub,marginBottom:6});

// ── Btn ────────────────────────────────────────────────────────────────────────
function Btn({onClick,disabled,primary,danger,sm,full,dark,children,style:xs={}}) {
  const T=mkT(dark);
  const base={padding:sm?"7px 14px":"10px 20px",borderRadius:8,cursor:disabled?"not-allowed":"pointer",fontSize:13,fontFamily:"Inter,sans-serif",fontWeight:600,border:"none",transition:"all 0.15s",width:full?"100%":undefined,...xs};
  const v = primary?{background:disabled?"#ccc":T.green,color:"#fff",opacity:disabled?0.7:1}:danger?{background:"transparent",border:`1px solid ${T.red}50`,color:T.red}:{background:"transparent",border:`1px solid ${T.border2}`,color:T.sub};
  return <button onClick={disabled?undefined:onClick} style={{...base,...v}}>{children}</button>;
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function Modal({title,onClose,wide,dark,children,isMobile}) {
  const T=mkT(dark);
  return (
    <div style={isMobile?{position:"fixed",inset:0,zIndex:300}:{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={isMobile?{position:"fixed",inset:0,background:T.surf,display:"flex",flexDirection:"column",animation:"slideUp 0.22s ease"}:{background:T.surf,border:`1px solid ${T.border}`,borderRadius:12,width:"100%",maxWidth:wide?720:540,maxHeight:"92vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(0,0,0,0.3)",animation:"su 0.18s ease"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 18px 14px",borderBottom:`1px solid ${T.border}`,flexShrink:0,background:T.surf}}>
          <span style={{fontSize:15,fontWeight:600,color:T.text,flex:1,marginRight:10,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{title}</span>
          <button onClick={onClose} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.sub,cursor:"pointer",padding:"6px 12px",fontSize:16,lineHeight:1,minWidth:36,minHeight:36,flexShrink:0}}>&times;</button>
        </div>
        <div style={{padding:"16px 18px",overflowY:"auto",flex:1,WebkitOverflowScrolling:"touch"}}>{children}</div>
      </div>
    </div>
  );
}

// ── Task Card (draggable) ──────────────────────────────────────────────────────
function TaskCard({task,ent,onClick,dark,onDragStart,onDragEnd,isDragging}) {
  const T=mkT(dark), p=PRIORITIES.find(x=>x.id===task.priority), od=isOD(task.dueDate,task.status);
  return (
    <div
      draggable
      onDragStart={e=>{ e.dataTransfer.setData("taskId",task.id); e.dataTransfer.effectAllowed="move"; onDragStart&&onDragStart(); }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"13px",cursor:"grab",boxShadow:"0 1px 3px rgba(0,0,0,0.06)",WebkitTapHighlightColor:"transparent",userSelect:"none",opacity:isDragging?0.35:1,transition:"opacity 0.15s"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:10,pointerEvents:isDragging?"none":"auto"}}>
        <span style={{width:3,flexShrink:0,minHeight:18,alignSelf:"stretch",borderRadius:4,background:p?.clr||"#ccc",display:"inline-block"}}/>
        <span style={{fontSize:13,fontWeight:500,lineHeight:1.45,flex:1,color:T.text}}>{task.title}</span>
        <span style={{fontSize:10,color:T.muted,flexShrink:0,marginTop:2}}>⠿</span>
      </div>
      {ent&&<div style={{pointerEvents:isDragging?"none":"auto",display:"inline-flex",alignItems:"center",gap:4,padding:"3px 9px",borderRadius:5,fontSize:11,fontWeight:500,background:ent.color+"15",color:ent.color,marginBottom:10,border:`1px solid ${ent.color}25`}}>{ent.icon} {ent.name}</div>}
      <div style={{display:"flex",alignItems:"center",gap:8,pointerEvents:isDragging?"none":"auto"}}>
        {task.dueDate&&<span style={{fontSize:11,color:od?T.red:T.muted}}>{od&&"⚠ "}{fmtDate(task.dueDate)}</span>}
        {(task.attachments||[]).length>0&&<span style={{fontSize:11,color:T.muted}}>📎 {task.attachments.length}</span>}
        {task.assignee&&<div style={{marginLeft:"auto",width:26,height:26,borderRadius:"50%",background:ent?.color+"20",border:`1.5px solid ${ent?.color||"#3b82f6"}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:ent?.color||"#3b82f6",flexShrink:0}}>{initials(task.assignee)}</div>}
      </div>
    </div>
  );
}

// ── Kanban (drag & drop) ───────────────────────────────────────────────────────
function Kanban({tasks,entities,onOpen,dark,isMobile,onStatusChange}) {
  const T=mkT(dark);
  const [draggingId,setDraggingId]=useState(null);
  const [overCol,setOverCol]=useState(null);
  const counters=useRef({});

  const onDragEnter=(colId,e)=>{ e.preventDefault(); counters.current[colId]=(counters.current[colId]||0)+1; setOverCol(colId); };
  const onDragLeave=(colId)=>{ counters.current[colId]=(counters.current[colId]||1)-1; if(counters.current[colId]<=0){ counters.current[colId]=0; setOverCol(p=>p===colId?null:p); } };
  const onDrop=(colId,e)=>{ e.preventDefault(); counters.current[colId]=0; const id=e.dataTransfer.getData("taskId"); if(id) onStatusChange(id,colId); setOverCol(null); setDraggingId(null); };

  return (
    <div style={{display:"flex",flex:1,overflowX:"auto",overflowY:"hidden",WebkitOverflowScrolling:"touch"}}>
      {STATUSES.map((s)=>{
        const colTasks=tasks.filter(t=>t.status===s.id);
        const isOver=overCol===s.id && draggingId && tasks.find(t=>t.id===draggingId)?.status!==s.id;
        return (
          <div key={s.id}
            onDragOver={e=>e.preventDefault()}
            onDragEnter={e=>onDragEnter(s.id,e)}
            onDragLeave={()=>onDragLeave(s.id)}
            onDrop={e=>onDrop(s.id,e)}
            style={{flexShrink:0,width:isMobile?290:undefined,flex:isMobile?"none":1,display:"flex",flexDirection:"column",borderRight:`1px solid ${T.border}`,minWidth:isMobile?290:190,background:isOver?s.clr+"0a":undefined,transition:"background 0.12s"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 14px 10px",flexShrink:0,borderBottom:`2px solid ${s.clr}`,background:isOver?s.clr+"14":T.surf,transition:"background 0.12s"}}>
              <span style={{width:8,height:8,borderRadius:"50%",background:s.clr,display:"inline-block"}}/>
              <span style={{fontSize:11,fontWeight:600,letterSpacing:"0.05em",textTransform:"uppercase",color:T.text}}>{s.label}</span>
              <span style={{marginLeft:"auto",fontSize:11,background:s.clr+"18",color:s.clr,padding:"1px 8px",borderRadius:10,fontWeight:500}}>{colTasks.length}</span>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"10px 10px 90px",display:"flex",flexDirection:"column",gap:8,background:T.bg,WebkitOverflowScrolling:"touch",minHeight:100}}>
              {colTasks.map(t=>(
                <TaskCard key={t.id} task={t} ent={entities.find(e=>e.id===t.entityId)}
                  onClick={()=>{ if(draggingId) return; onOpen(t); }} dark={dark}
                  onDragStart={()=>setDraggingId(t.id)}
                  onDragEnd={()=>{ setDraggingId(null); setOverCol(null); Object.keys(counters.current).forEach(k=>counters.current[k]=0); }}
                  isDragging={draggingId===t.id}/>
              ))}
              {isOver&&<div style={{height:54,borderRadius:10,border:`2px dashed ${s.clr}60`,background:s.clr+"08",flexShrink:0}}/>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── List View ──────────────────────────────────────────────────────────────────
function ListCard({task,ent,s,p,onClick,dark}) {
  const T=mkT(dark), od=isOD(task.dueDate,task.status);
  return (
    <div onClick={onClick} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"13px 14px",cursor:"pointer",marginBottom:8,WebkitTapHighlightColor:"transparent"}}>
      <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8}}>
        <span style={{width:3,flexShrink:0,height:36,borderRadius:4,background:p?.clr||"#ccc",display:"inline-block",marginTop:2}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:13,fontWeight:500,color:T.text,marginBottom:6}}>{task.title}</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {ent&&<span style={{fontSize:10,fontWeight:500,background:ent.color+"15",color:ent.color,padding:"2px 8px",borderRadius:4,border:`1px solid ${ent.color}25`}}>{ent.icon} {ent.name}</span>}
            <span style={{fontSize:10,fontWeight:600,background:s?.clr+"15",color:s?.clr,padding:"2px 8px",borderRadius:10,border:`1px solid ${s?.clr}30`}}>{s?.label}</span>
            <span style={{fontSize:10,color:T.muted,display:"flex",alignItems:"center",gap:3}}><span style={{width:5,height:5,borderRadius:"50%",background:p?.clr,display:"inline-block"}}/>{p?.label}</span>
          </div>
        </div>
        {task.assignee&&<div style={{width:28,height:28,borderRadius:"50%",background:ent?.color+"20",border:`1.5px solid ${ent?.color||"#3b82f6"}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:ent?.color||"#3b82f6",flexShrink:0}}>{initials(task.assignee)}</div>}
      </div>
      {(task.dueDate||(task.attachments||[]).length>0)&&(
        <div style={{display:"flex",gap:10,paddingLeft:11}}>
          {task.dueDate&&<span style={{fontSize:11,color:od?T.red:T.muted}}>{od&&"⚠ "}{fmtDate(task.dueDate)}</span>}
          {(task.attachments||[]).length>0&&<span style={{fontSize:11,color:T.muted}}>📎 {task.attachments.length}</span>}
        </div>
      )}
    </div>
  );
}
function ListView({tasks,entities,onOpen,dark}) {
  const T=mkT(dark);
  return (
    <div style={{flex:1,overflowY:"auto",padding:"12px 14px 90px",background:T.bg,WebkitOverflowScrolling:"touch"}}>
      {tasks.length===0&&<div style={{textAlign:"center",color:T.muted,paddingTop:60,fontSize:13}}>Aucune tâche</div>}
      {tasks.map(t=><ListCard key={t.id} task={t} ent={entities.find(e=>e.id===t.entityId)} s={STATUSES.find(x=>x.id===t.status)} p={PRIORITIES.find(x=>x.id===t.priority)} onClick={()=>onOpen(t)} dark={dark}/>)}
    </div>
  );
}

// ── Task Form ──────────────────────────────────────────────────────────────────
function TaskFormModal({data,mode,entities,onSave,onClose,dark,isMobile}) {
  const T=mkT(dark);
  const [f,sf]=useState({title:"",desc:"",status:"todo",priority:"medium",dueDate:"",assignee:"",email:"",entityId:"",...data});
  const set=(k,v)=>sf(p=>({...p,[k]:v})); const ok=f.title.trim()&&f.entityId;
  return (
    <Modal title={mode==="edit"?"Modifier la tâche":"Nouvelle tâche"} onClose={onClose} dark={dark} isMobile={isMobile}>
      <div style={{marginBottom:14}}><label style={mkLbl(T)}>Titre *</label><input value={f.title} onChange={e=>set("title",e.target.value)} placeholder="Intitulé..." style={mkInp(T)}/></div>
      <div style={{marginBottom:14}}><label style={mkLbl(T)}>Description</label><textarea value={f.desc} onChange={e=>set("desc",e.target.value)} rows={3} placeholder="Détails..." style={mkInp(T,{resize:"vertical"})}/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <div><label style={mkLbl(T)}>Entité *</label><select value={f.entityId} onChange={e=>set("entityId",e.target.value)} style={mkInp(T,{cursor:"pointer"})}><option value="">— Choisir —</option>{entities.map(e=><option key={e.id} value={e.id}>{e.icon} {e.name}</option>)}</select></div>
        <div><label style={mkLbl(T)}>Statut</label><select value={f.status} onChange={e=>set("status",e.target.value)} style={mkInp(T,{cursor:"pointer"})}>{STATUSES.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <div><label style={mkLbl(T)}>Priorité</label><select value={f.priority} onChange={e=>set("priority",e.target.value)} style={mkInp(T,{cursor:"pointer"})}>{PRIORITIES.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div><label style={mkLbl(T)}>Échéance</label><input type="date" value={f.dueDate} onChange={e=>set("dueDate",e.target.value)} style={mkInp(T,{colorScheme:dark?"dark":"light"})}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:4}}>
        <div><label style={mkLbl(T)}>Assigné à</label><input value={f.assignee} onChange={e=>set("assignee",e.target.value)} placeholder="Nom..." style={mkInp(T)}/></div>
        <div><label style={mkLbl(T)}>Email</label><input type="email" value={f.email} onChange={e=>set("email",e.target.value)} placeholder="email@..." style={mkInp(T)}/></div>
      </div>
      <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,paddingTop:16,borderTop:`1px solid ${T.border}`,marginTop:16,justifyContent:"flex-end"}}>
        <Btn onClick={onClose} dark={dark} full={isMobile}>Annuler</Btn>
        <Btn primary disabled={!ok} onClick={()=>ok&&onSave(f)} dark={dark} full={isMobile}>{mode==="edit"?"Enregistrer":"Créer la tâche"}</Btn>
      </div>
    </Modal>
  );
}

// ── Detail Modal ───────────────────────────────────────────────────────────────
function DetailModal({task,entities,onEdit,onDelete,onStatus,onAddFile,onRemoveFile,onClose,onAlert,dark,isMobile}) {
  const T=mkT(dark), ent=entities.find(e=>e.id===task.entityId), s=STATUSES.find(x=>x.id===task.status), p=PRIORITIES.find(x=>x.id===task.priority), od=isOD(task.dueDate,task.status);
  const fileRef=useRef();
  return (
    <Modal title={task.title} onClose={onClose} wide dark={dark} isMobile={isMobile}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {ent&&<div style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:500,background:ent.color+"15",color:ent.color,border:`1px solid ${ent.color}25`}}>{ent.icon} {ent.name}</div>}
        <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:6,background:T.card2,border:`1px solid ${T.border}`}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:p?.clr||"#ccc",display:"inline-block"}}/>
          <span style={{fontSize:11,color:p?.clr||T.text,fontWeight:600}}>{p?.label}</span>
        </div>
      </div>
      {task.desc&&<div style={{background:T.card2,borderRadius:8,padding:"12px",marginBottom:14,fontSize:13,color:T.sub,lineHeight:1.7,border:`1px solid ${T.border}`}}>{task.desc}</div>}
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Statut</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {STATUSES.map(st=>(<button key={st.id} onClick={()=>onStatus(st.id)} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${task.status===st.id?st.clr+"60":"transparent"}`,cursor:"pointer",fontSize:12,fontWeight:600,background:task.status===st.id?st.clr+"18":"transparent",color:task.status===st.id?st.clr:T.muted,transition:"all 0.12s",minHeight:38}}>{st.label}</button>))}
        </div>
      </div>
      <div style={{background:T.card2,borderRadius:10,padding:"0 14px",marginBottom:14,border:`1px solid ${T.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:`1px solid ${T.border}`}}>
          <span style={{fontSize:12,color:T.muted,fontWeight:500}}>Échéance</span>
          <span style={{fontSize:13,fontWeight:600,color:od?T.red:T.text}}>{od&&"⚠ "}{fmtDate(task.dueDate)}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0"}}>
          <span style={{fontSize:12,color:T.muted,fontWeight:500}}>Assigné à</span>
          {task.assignee?<div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:26,height:26,borderRadius:"50%",background:ent?.color+"20",border:`1.5px solid ${ent?.color||"#3b82f6"}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:ent?.color||"#3b82f6"}}>{initials(task.assignee)}</div><span style={{fontSize:13,color:T.text,fontWeight:500}}>{task.assignee}</span></div>:<span style={{fontSize:12,color:T.muted}}>Non assigné</span>}
        </div>
      </div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:11,color:T.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Pièces jointes ({(task.attachments||[]).length})</div>
        {(task.attachments||[]).map(a=>(
          <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,background:T.card2,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 10px",marginBottom:6}}>
            <span style={{fontSize:18}}>{fileIco(a.type)}</span>
            <div style={{flex:1,overflow:"hidden"}}>
              {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{fontSize:12,fontWeight:500,color:T.blue,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block",textDecoration:"none"}}>{a.name} ↗</a>
                : <div style={{fontSize:12,fontWeight:500,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</div>}
              <div style={{fontSize:10,color:T.muted}}>{fileSz(a.size)}</div>
            </div>
            <button onClick={()=>onRemoveFile(a.id,a.path)} style={{background:"none",border:"none",color:T.muted,cursor:"pointer",fontSize:18,padding:"4px 8px",minHeight:36}}>&times;</button>
          </div>
        ))}
        <input type="file" multiple ref={fileRef} style={{display:"none"}} onChange={e=>{onAddFile([...e.target.files]);e.target.value="";}}/>
        <Btn sm onClick={()=>fileRef.current?.click()} dark={dark}>+ Ajouter un fichier</Btn>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,paddingTop:14,borderTop:`1px solid ${T.border}`}}>
        <Btn primary onClick={onAlert} dark={dark} full>✉️ Envoyer une alerte email</Btn>
        <div style={{display:"flex",gap:8}}><Btn onClick={onEdit} dark={dark} style={{flex:1}}>✏️ Modifier</Btn><Btn danger onClick={onDelete} dark={dark} style={{flex:1}}>🗑️ Supprimer</Btn></div>
      </div>
    </Modal>
  );
}

// ── Alert Modal ────────────────────────────────────────────────────────────────
function AlertModal({task,entities,sending,onSend,onClose,dark,isMobile}) {
  const T=mkT(dark), ent=entities.find(e=>e.id===task.entityId);
  const [email,setEmail]=useState(task.email||""), [msg,setMsg]=useState("");
  return (
    <Modal title="Envoyer une alerte email" onClose={onClose} dark={dark} isMobile={isMobile}>
      <div style={{background:T.card2,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 13px",marginBottom:14,fontSize:13,color:T.sub}}><strong style={{color:T.text}}>{task.title}</strong> · {ent?.icon} {ent?.name||"—"}</div>
      <div style={{marginBottom:13}}><label style={mkLbl(T)}>Destinataire *</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="email@exemple.com" style={mkInp(T)}/></div>
      <div style={{marginBottom:16}}><label style={mkLbl(T)}>Message (optionnel)</label><textarea value={msg} onChange={e=>setMsg(e.target.value)} rows={3} style={mkInp(T,{resize:"vertical"})}/></div>
      <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,paddingTop:14,borderTop:`1px solid ${T.border}`,justifyContent:"flex-end"}}>
        <Btn onClick={onClose} dark={dark} full={isMobile}>Annuler</Btn>
        <Btn primary disabled={!email||sending} onClick={()=>email&&onSend(email,msg)} dark={dark} full={isMobile}>{sending?"Envoi...":"✉️ Envoyer"}</Btn>
      </div>
    </Modal>
  );
}

// ── Entity Modal ───────────────────────────────────────────────────────────────
function EntityModal({onSave,onClose,dark,isMobile}) {
  const T=mkT(dark);
  const [f,sf]=useState({name:"",icon:"🏢",color:ENT_COLORS[0]});
  const set=(k,v)=>sf(p=>({...p,[k]:v}));
  return (
    <Modal title="Nouvelle entité" onClose={onClose} dark={dark} isMobile={isMobile}>
      <div style={{marginBottom:14}}><label style={mkLbl(T)}>Nom *</label><input value={f.name} onChange={e=>set("name",e.target.value)} placeholder="Nom de l'entité..." style={mkInp(T)}/></div>
      <div style={{marginBottom:14}}><label style={mkLbl(T)}>Icône</label><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{ICONS.map(ic=><button key={ic} onClick={()=>set("icon",ic)} style={{fontSize:20,padding:"7px 10px",borderRadius:8,border:`2px solid ${f.icon===ic?T.green:T.border}`,background:f.icon===ic?T.green+"15":"transparent",cursor:"pointer",minHeight:44}}>{ic}</button>)}</div></div>
      <div style={{marginBottom:16}}><label style={mkLbl(T)}>Couleur</label><div style={{display:"flex",gap:10,flexWrap:"wrap"}}>{ENT_COLORS.map(c=><button key={c} onClick={()=>set("color",c)} style={{width:34,height:34,borderRadius:"50%",background:c,border:`3px solid ${f.color===c?"#fff":"transparent"}`,cursor:"pointer",outline:f.color===c?`2px solid ${c}`:"none"}}/>)}</div></div>
      <div style={{display:"flex",flexDirection:isMobile?"column":"row",gap:8,paddingTop:14,borderTop:`1px solid ${T.border}`,justifyContent:"flex-end"}}>
        <Btn onClick={onClose} dark={dark} full={isMobile}>Annuler</Btn>
        <Btn primary disabled={!f.name.trim()} onClick={()=>f.name.trim()&&onSave(f)} dark={dark} full={isMobile}>Créer l'entité</Btn>
      </div>
    </Modal>
  );
}

// ── Mobile Drawer ──────────────────────────────────────────────────────────────
function Drawer({open,onClose,entities,tasks,selEnt,sse,dark,onNewEnt,onDelEnt,setDark}) {
  if(!open) return null;
  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.55)",zIndex:400}}/>
      <div style={{position:"fixed",top:0,left:0,bottom:0,width:270,background:SB.bg,zIndex:401,display:"flex",flexDirection:"column",animation:"slideRight 0.22s ease",overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
        <div style={{padding:"20px 18px 14px",borderBottom:`1px solid ${SB.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontSize:17,fontWeight:700,color:"#fff"}}>Task<span style={{color:"#3b82f6"}}>Pilot</span></div><div style={{fontSize:9,color:SB.muted,letterSpacing:"0.1em",marginTop:3,textTransform:"uppercase"}}>Gestion des tâches</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:SB.muted,fontSize:22,cursor:"pointer",padding:"4px 8px",minHeight:36}}>&times;</button>
        </div>
        <div style={{flex:1,padding:"10px 0"}}>
          <div style={{padding:"8px 16px 4px",fontSize:9,fontWeight:600,color:SB.muted,letterSpacing:"0.12em",textTransform:"uppercase"}}>Entités</div>
          <button onClick={()=>{sse(null);onClose();}} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"13px 16px",background:selEnt===null?SB.active:"transparent",border:"none",borderLeft:selEnt===null?`3px solid ${SB.accent}`:"3px solid transparent",color:selEnt===null?"#fff":SB.text,fontFamily:"Inter,sans-serif",fontSize:14,cursor:"pointer",textAlign:"left"}}>
            <span>📋</span><span style={{flex:1}}>Toutes les tâches</span><span style={{fontSize:11,background:"rgba(255,255,255,0.08)",color:SB.muted,padding:"2px 8px",borderRadius:10}}>{tasks.length}</span>
          </button>
          {entities.map(ent=>(
            <div key={ent.id} style={{display:"flex",alignItems:"center"}}>
              <button onClick={()=>{sse(ent.id);onClose();}} style={{display:"flex",alignItems:"center",gap:9,flex:1,padding:"13px 16px",background:selEnt===ent.id?SB.active:"transparent",border:"none",borderLeft:selEnt===ent.id?`3px solid ${ent.color}`:"3px solid transparent",color:selEnt===ent.id?ent.color:SB.text,fontFamily:"Inter,sans-serif",fontSize:14,cursor:"pointer",textAlign:"left"}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:ent.color,flexShrink:0}}/><span style={{flex:1}}>{ent.icon} {ent.name}</span>
                <span style={{fontSize:11,background:"rgba(255,255,255,0.08)",color:SB.muted,padding:"2px 8px",borderRadius:10}}>{tasks.filter(t=>t.entityId===ent.id).length}</span>
              </button>
              <button onClick={()=>onDelEnt(ent.id)} style={{background:"none",border:"none",color:SB.muted,cursor:"pointer",fontSize:18,padding:"4px 14px",minHeight:44}}>&times;</button>
            </div>
          ))}
          <button onClick={()=>{onNewEnt();onClose();}} style={{display:"flex",alignItems:"center",gap:8,width:"calc(100% - 20px)",margin:"8px 10px",padding:"10px 12px",borderRadius:8,cursor:"pointer",background:"transparent",border:`1px dashed ${SB.border}`,color:SB.muted,fontFamily:"Inter,sans-serif",fontSize:13}}>+ Nouvelle entité</button>
        </div>
        <div style={{padding:"10px 12px",borderTop:`1px solid ${SB.border}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {STATUSES.map(s=>(<div key={s.id} style={{background:"rgba(255,255,255,0.04)",borderRadius:8,padding:"8px 10px",border:`1px solid ${SB.border}`}}><div style={{fontSize:18,fontWeight:700,color:s.clr,lineHeight:1}}>{tasks.filter(t=>t.status===s.id).length}</div><div style={{fontSize:9,color:SB.muted,marginTop:3,fontWeight:500}}>{s.label}</div></div>))}
        </div>
        <div style={{padding:"14px 16px",borderTop:`1px solid ${SB.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontSize:13,color:SB.muted}}>{dark?"Thème sombre":"Thème clair"}</span>
          <button onClick={()=>setDark(d=>!d)} style={{width:44,height:24,borderRadius:12,border:"none",cursor:"pointer",background:dark?"#3b82f6":"rgba(255,255,255,0.15)",transition:"background 0.2s",position:"relative",padding:0}}>
            <span style={{position:"absolute",top:4,left:dark?22:4,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
          </button>
        </div>
      </div>
    </>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const isMobile=useIsMobile();
  const [dark,setDark]=useState(false);
  const [entities,se]=useState([]);
  const [tasks,st]=useState([]);
  const [loading,sl]=useState(true);
  const [selEnt,sse]=useState(null);
  const [view,sv]=useState("kanban");
  const [taskForm,stf]=useState(null);
  const [detail,sd]=useState(null);
  const [entForm,sef]=useState(false);
  const [alertOpen,sa]=useState(false);
  const [sending,ss]=useState(false);
  const [notif,sn]=useState(null);
  const [drawerOpen,sdr]=useState(false);
  const T=mkT(dark);

  // Load on mount
  useEffect(()=>{
    dbLoadAll().then(({entities:e,tasks:t})=>{ se(e); st(t); sl(false); });
  },[]);

  // Sync to localStorage when no supabase
  useEffect(()=>{ if(!supabase && !loading) lsSave({entities,tasks}); },[entities,tasks,loading]);

  // Real-time subscription
  useEffect(()=>{
    if(!supabase) return;
    const ch = supabase.channel("realtime-tasks")
      .on("postgres_changes",{event:"*",schema:"public",table:"tasks"},()=>{ dbLoadAll().then(({tasks:t})=>st(t)); })
      .on("postgres_changes",{event:"*",schema:"public",table:"entities"},()=>{ dbLoadAll().then(({entities:e})=>se(e)); })
      .subscribe();
    return ()=>{ supabase.removeChannel(ch); };
  },[]);

  useEffect(()=>{ if(notif){ const t=setTimeout(()=>sn(null),3000); return()=>clearTimeout(t); } },[notif]);
  const notify=(msg,err=false)=>sn({msg,err});

  const filtered=selEnt?tasks.filter(t=>t.entityId===selEnt):tasks;
  const total=filtered.length;
  const selEntObj=entities.find(e=>e.id===selEnt);

  const saveTask=async f=>{
    const isEdit=taskForm.mode==="edit";
    const n=isEdit?f:{...f,id:"t"+uid(),attachments:[],createdAt:Date.now()};
    st(p=>isEdit?p.map(t=>t.id===n.id?n:t):[n,...p]);
    if(isEdit&&detail?.id===n.id) sd(n);
    await dbUpsertTask(n);
    notify(isEdit?"Tâche modifiée ✓":"Tâche créée ✓");
    stf(null);
  };
  const delTask=async id=>{ st(p=>p.filter(t=>t.id!==id)); sd(null); await dbDeleteTask(id); notify("Tâche supprimée"); };
  const setStatus=async(id,s)=>{ st(p=>p.map(t=>t.id===id?{...t,status:s}:t)); if(detail?.id===id)sd(p=>({...p,status:s})); await dbUpdateTask(id,{status:s}); };
  const addFile=async(id,files)=>{
    notify("Upload en cours...");
    try {
      const uploaded = await Promise.all(files.map(f=>uploadFile(f)));
      const newAtts=[...(tasks.find(t=>t.id===id)?.attachments||[]),...uploaded];
      st(p=>p.map(t=>t.id===id?{...t,attachments:newAtts}:t));
      if(detail?.id===id)sd(p=>({...p,attachments:newAtts}));
      await dbUpdateTask(id,{attachments:newAtts});
      notify(`${uploaded.length} fichier(s) ajouté(s) ✓`);
    } catch(e) { notify("Erreur upload — "+e.message,true); }
  };
  const rmFile=async(id,fid,path)=>{
    const newAtts=(tasks.find(t=>t.id===id)?.attachments||[]).filter(a=>a.id!==fid);
    st(p=>p.map(t=>t.id===id?{...t,attachments:newAtts}:t));
    if(detail?.id===id)sd(p=>({...p,attachments:newAtts}));
    await Promise.all([dbUpdateTask(id,{attachments:newAtts}), deleteFile(path)]);
  };
  const addEntity=async data=>{ const e={...data,id:"e"+uid()}; se(p=>[...p,e]); await dbAddEntity(e); sef(false); notify("Entité créée ✓"); };
  const rmEntity=async id=>{ se(p=>p.filter(e=>e.id!==id)); st(p=>p.filter(t=>t.entityId!==id)); if(selEnt===id)sse(null); await dbDeleteEntity(id); notify("Entité supprimée"); };
  const reorderEntities=(fromId,toId)=>{ if(fromId===toId) return; se(p=>{ const a=[...p]; const fi=a.findIndex(e=>e.id===fromId); const ti=a.findIndex(e=>e.id===toId); const [m]=a.splice(fi,1); a.splice(ti,0,m); return a; }); };
  const doAlert=async(email,msg)=>{ ss(true); try{ await sendEmail(detail,entities.find(e=>e.id===detail.entityId),email,msg); sa(false); notify(`Alerte envoyée à ${email} ✓`); }catch(e){ notify("Erreur d'envoi : "+e.message,true); } ss(false); };

  if(loading) return (
    <div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#16202e",flexDirection:"column",gap:12}}>
      <div style={{fontSize:28,fontWeight:700,color:"#fff"}}>Task<span style={{color:"#3b82f6"}}>Pilot</span></div>
      <div style={{fontSize:13,color:"#617d97"}}>{supabase?"Connexion à Supabase...":"Chargement..."}</div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;overflow:hidden}
        body{background:#16202e;font-family:Inter,sans-serif}
        @keyframes su{from{transform:translateY(12px);opacity:0}to{transform:none;opacity:1}}
        @keyframes si{from{transform:translateX(12px);opacity:0}to{transform:none;opacity:1}}
        @keyframes slideUp{from{transform:translateY(100%)}to{transform:none}}
        @keyframes slideRight{from{transform:translateX(-100%)}to{transform:none}}
        ::-webkit-scrollbar{width:4px;height:4px}::-webkit-scrollbar-thumb{background:rgba(128,128,128,0.3);border-radius:2px}
        select option{background:#1e293b;color:#f1f5f9}
        textarea:focus,input:focus,select:focus{outline:2px solid #10b981!important;border-color:#10b981!important}
        button{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
      `}</style>

      {supabase&&<div style={{position:"fixed",top:8,right:12,width:6,height:6,borderRadius:"50%",background:"#10b981",zIndex:999,boxShadow:"0 0 0 2px rgba(16,185,129,0.2)"}} title="Supabase connecté"/>}

      <div style={{display:"flex",height:"100vh",overflow:"hidden",paddingTop:0}}>
        {!isMobile&&(
          <aside style={{width:230,background:SB.bg,borderRight:`1px solid ${SB.border}`,display:"flex",flexDirection:"column",flexShrink:0,overflow:"hidden"}}>
            <div style={{padding:"18px 18px 14px",borderBottom:`1px solid ${SB.border}`}}>
              <div style={{fontSize:17,fontWeight:700,color:"#fff"}}>Task<span style={{color:"#3b82f6"}}>Pilot</span></div>
              <div style={{fontSize:9,color:SB.muted,letterSpacing:"0.1em",marginTop:4,textTransform:"uppercase"}}>Gestion des tâches</div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"10px 0"}}>
              <div style={{padding:"8px 16px 4px",fontSize:9,fontWeight:600,color:SB.muted,letterSpacing:"0.12em",textTransform:"uppercase"}}>Entités</div>
              <button onClick={()=>sse(null)} style={{display:"flex",alignItems:"center",gap:9,width:"100%",padding:"9px 16px",background:selEnt===null?SB.active:"transparent",border:"none",borderLeft:selEnt===null?`3px solid ${SB.accent}`:"3px solid transparent",color:selEnt===null?"#fff":SB.text,fontFamily:"Inter,sans-serif",fontSize:13,cursor:"pointer",textAlign:"left",transition:"all 0.12s"}}>
                <span>📋</span><span style={{flex:1}}>Toutes les tâches</span><span style={{fontSize:10,background:"rgba(255,255,255,0.08)",color:SB.muted,padding:"1px 7px",borderRadius:10}}>{tasks.length}</span>
              </button>
              {entities.map(ent=>(
                <div key={ent.id} draggable
                  onDragStart={e=>{ e.dataTransfer.setData("entId",ent.id); e.dataTransfer.effectAllowed="move"; }}
                  onDragOver={e=>e.preventDefault()}
                  onDrop={e=>{ e.preventDefault(); e.stopPropagation(); reorderEntities(e.dataTransfer.getData("entId"),ent.id); }}
                  style={{display:"flex",alignItems:"center",cursor:"grab"}}>
                  <span style={{color:SB.muted,fontSize:12,padding:"0 4px 0 10px",flexShrink:0,pointerEvents:"none"}}>⠿</span>
                  <button onClick={()=>sse(ent.id)} style={{display:"flex",alignItems:"center",gap:9,flex:1,padding:"9px 8px 9px 4px",background:selEnt===ent.id?SB.active:"transparent",border:"none",color:selEnt===ent.id?ent.color:SB.text,fontFamily:"Inter,sans-serif",fontSize:13,cursor:"pointer",textAlign:"left",transition:"all 0.12s",pointerEvents:"auto"}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:ent.color,flexShrink:0,pointerEvents:"none"}}/><span style={{flex:1,pointerEvents:"none"}}>{ent.icon} {ent.name}</span>
                    <span style={{fontSize:10,background:"rgba(255,255,255,0.08)",color:SB.muted,padding:"1px 7px",borderRadius:10,pointerEvents:"none"}}>{tasks.filter(t=>t.entityId===ent.id).length}</span>
                  </button>
                  <button onClick={()=>rmEntity(ent.id)} style={{background:"none",border:"none",color:SB.muted,cursor:"pointer",fontSize:15,padding:"4px 10px",opacity:0.6}}>&times;</button>
                </div>
              ))}
              <button onClick={()=>sef(true)} style={{display:"flex",alignItems:"center",gap:8,width:"calc(100% - 20px)",margin:"8px 10px",padding:"7px 12px",borderRadius:7,cursor:"pointer",background:"transparent",border:`1px dashed ${SB.border}`,color:SB.muted,fontFamily:"Inter,sans-serif",fontSize:12}}>+ Nouvelle entité</button>
            </div>
            <div style={{padding:"10px 12px",borderTop:`1px solid ${SB.border}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {STATUSES.map(s=>(<div key={s.id} style={{background:"rgba(255,255,255,0.04)",borderRadius:7,padding:"8px 10px",border:`1px solid ${SB.border}`}}><div style={{fontSize:17,fontWeight:700,color:s.clr,lineHeight:1}}>{tasks.filter(t=>t.status===s.id).length}</div><div style={{fontSize:9,color:SB.muted,marginTop:3,fontWeight:500}}>{s.label}</div></div>))}
            </div>
            <div style={{padding:"12px 16px",borderTop:`1px solid ${SB.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:SB.muted}}>{dark?"Thème sombre":"Thème clair"}</span>
              <button onClick={()=>setDark(d=>!d)} style={{width:40,height:22,borderRadius:11,border:"none",cursor:"pointer",background:dark?"#3b82f6":"rgba(255,255,255,0.15)",transition:"background 0.2s",position:"relative",padding:0}}>
                <span style={{position:"absolute",top:3,left:dark?20:3,width:16,height:16,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.3)"}}/>
              </button>
            </div>
          </aside>
        )}

        {isMobile&&<Drawer open={drawerOpen} onClose={()=>sdr(false)} entities={entities} tasks={tasks} selEnt={selEnt} sse={sse} dark={dark} onNewEnt={()=>sef(true)} onDelEnt={rmEntity} setDark={setDark}/>}

        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden",background:T.bg}}>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:isMobile?"10px 14px":"12px 20px",borderBottom:`1px solid ${T.border}`,background:T.surf,flexShrink:0}}>
            {isMobile&&(<button onClick={()=>sdr(true)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.sub,cursor:"pointer",padding:"8px 11px",fontSize:16,lineHeight:1,flexShrink:0,minHeight:38}}>☰</button>)}
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontSize:isMobile?14:16,fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{selEntObj?`${selEntObj.icon} ${selEntObj.name}`:"Tableau de bord"}</div>
              {!isMobile&&<div style={{fontSize:11,color:T.muted,marginTop:1}}>{new Date().toLocaleDateString("fr-FR",{weekday:"long",day:"numeric",month:"long"})}</div>}
            </div>
            <div style={{display:"flex",background:T.bg,borderRadius:7,padding:2,border:`1px solid ${T.border}`,flexShrink:0}}>
              {["kanban","list"].map(v=>(<button key={v} onClick={()=>sv(v)} style={{padding:isMobile?"6px 10px":"5px 12px",borderRadius:5,border:"none",fontFamily:"Inter,sans-serif",background:view===v?T.surf:"transparent",color:view===v?T.text:T.muted,cursor:"pointer",fontSize:11,fontWeight:view===v?600:400,boxShadow:view===v?"0 1px 3px rgba(0,0,0,0.08)":"none",transition:"all 0.15s"}}>{v==="kanban"?"Kanban":"Liste"}</button>))}
            </div>
            {!isMobile&&(<button onClick={()=>stf({mode:"create",data:{entityId:selEnt||entities[0]?.id||""}})} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:7,background:"#16202e",color:"#fff",fontWeight:600,fontSize:13,border:"none",cursor:"pointer",fontFamily:"Inter,sans-serif",flexShrink:0}}>+ Nouvelle tâche</button>)}
          </div>

          <div style={{display:"flex",borderBottom:`1px solid ${T.border}`,background:T.surf,flexShrink:0}}>
            {STATUSES.map((s,i)=>{ const cnt=filtered.filter(t=>t.status===s.id).length; const pct=total?Math.round(cnt/total*100):0; return (
              <div key={s.id} style={{flex:1,padding:isMobile?"8px 10px":"12px 20px",borderRight:i<3?`1px solid ${T.border}`:"none"}}>
                <div style={{display:"flex",alignItems:"baseline",gap:4}}><span style={{fontSize:isMobile?18:22,fontWeight:700,color:s.clr,lineHeight:1}}>{cnt}</span>{!isMobile&&<span style={{fontSize:10,color:T.muted,fontWeight:500,textTransform:"uppercase",letterSpacing:"0.04em"}}>{s.label}</span>}</div>
                {isMobile&&<div style={{fontSize:9,color:T.muted,marginTop:2,fontWeight:500,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.label}</div>}
                <div style={{height:3,background:T.border,borderRadius:2,marginTop:5}}><div style={{height:"100%",width:`${pct}%`,background:s.clr,borderRadius:2,transition:"width 0.4s"}}/></div>
              </div>
            );})}
          </div>

          {filtered.length===0?(
            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,background:T.bg,paddingBottom:isMobile?80:0}}>
              <div style={{fontSize:44}}>📋</div><div style={{fontSize:16,fontWeight:600,color:T.sub}}>Aucune tâche</div><div style={{fontSize:13,color:T.muted}}>Créez votre première tâche</div>
            </div>
          ):view==="kanban"?<Kanban tasks={filtered} entities={entities} onOpen={sd} dark={dark} isMobile={isMobile} onStatusChange={(id,s)=>setStatus(id,s)}/>:<ListView tasks={filtered} entities={entities} onOpen={sd} dark={dark}/> }
        </div>
      </div>

      {isMobile&&(
        <div style={{position:"fixed",bottom:0,left:0,right:0,background:SB.bg,borderTop:`1px solid ${SB.border}`,display:"flex",zIndex:100,paddingBottom:"env(safe-area-inset-bottom)",height:60}}>
          <button onClick={()=>sdr(true)} style={{flex:1,background:"none",border:"none",color:SB.muted,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,fontFamily:"Inter,sans-serif",fontSize:9,fontWeight:500}}><span style={{fontSize:16}}>☰</span>Menu</button>
          <button onClick={()=>sv("kanban")} style={{flex:1,background:"none",border:"none",color:view==="kanban"?"#fff":SB.muted,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,fontFamily:"Inter,sans-serif",fontSize:9,fontWeight:500}}><span style={{fontSize:16}}>⊞</span>Kanban</button>
          <button onClick={()=>stf({mode:"create",data:{entityId:selEnt||entities[0]?.id||""}})} style={{flex:1,background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,fontFamily:"Inter,sans-serif",fontSize:9,fontWeight:600}}>
            <span style={{width:40,height:40,borderRadius:"50%",background:"#16202e",border:"2px solid #3b82f6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#fff",marginTop:-22,boxShadow:"0 4px 16px rgba(59,130,246,0.35)"}}>+</span>
            <span style={{color:"#3b82f6",marginTop:2}}>Nouveau</span>
          </button>
          <button onClick={()=>sv("list")} style={{flex:1,background:"none",border:"none",color:view==="list"?"#fff":SB.muted,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,fontFamily:"Inter,sans-serif",fontSize:9,fontWeight:500}}><span style={{fontSize:16}}>≡</span>Liste</button>
          <button onClick={()=>setDark(d=>!d)} style={{flex:1,background:"none",border:"none",color:SB.muted,cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,fontFamily:"Inter,sans-serif",fontSize:9,fontWeight:500}}><span style={{fontSize:16}}>{dark?"☀️":"🌙"}</span>{dark?"Clair":"Sombre"}</button>
        </div>
      )}

      {taskForm&&<TaskFormModal data={taskForm.data} mode={taskForm.mode} entities={entities} onSave={saveTask} onClose={()=>stf(null)} dark={dark} isMobile={isMobile}/>}
      {detail&&<DetailModal task={detail} entities={entities} onEdit={()=>{stf({mode:"edit",data:{...detail}});sd(null);}} onDelete={()=>delTask(detail.id)} onStatus={s=>setStatus(detail.id,s)} onAddFile={files=>addFile(detail.id,files)} onRemoveFile={(fid,path)=>rmFile(detail.id,fid,path)} onClose={()=>sd(null)} onAlert={()=>sa(true)} dark={dark} isMobile={isMobile}/> }
      {entForm&&<EntityModal onSave={addEntity} onClose={()=>sef(false)} dark={dark} isMobile={isMobile}/>}
      {alertOpen&&detail&&<AlertModal task={detail} entities={entities} sending={sending} onSend={doAlert} onClose={()=>sa(false)} dark={dark} isMobile={isMobile}/>}

      {notif&&(<div style={{position:"fixed",bottom:isMobile?72:22,right:16,left:isMobile?16:undefined,zIndex:500,background:notif.err?"#fef2f2":"#f0fdf4",border:`1px solid ${notif.err?"#fca5a5":"#bbf7d0"}`,borderRadius:10,padding:"11px 16px",fontSize:13,display:"flex",alignItems:"center",gap:9,boxShadow:"0 6px 24px rgba(0,0,0,0.12)",animation:"si 0.2s ease",color:notif.err?"#dc2626":"#15803d",fontWeight:500}}>{notif.err?"⚠️":"✓"} {notif.msg}</div>)}
    </>
  );
}
