var token='';
async function api(path,opt){opt=opt||{};opt.headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});if(token)opt.headers.Authorization='Bearer '+token;var r=await fetch(path,opt);var d=await r.json().catch(function(){return{}});if(!r.ok)throw new Error(d.error||'Error '+r.status);return d}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

async function doLogin(){
 document.getElementById('loginErr').textContent='';
 try{
  var d=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:document.getElementById('user').value,password:document.getElementById('pass').value})});
  if(d.user.role!=='store' && d.user.role!=='admin' && d.user.role!=='superadmin'){ throw new Error('Esta cuenta no es de tienda. Usa una cuenta con rol store.'); }
  // Si es admin entrando a tienda, permitir pero avisar
  token=d.token;
  document.getElementById('userLabel').textContent=d.user.username;
  document.getElementById('loginPage').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  loadStore();
  setInterval(loadStore,12000);
 }catch(e){ document.getElementById('loginErr').textContent=e.message; }
}
function doLogout(){ token=''; document.getElementById('loginPage').classList.remove('hidden'); document.getElementById('app').classList.add('hidden'); }
document.getElementById('pass').addEventListener('keydown',function(e){ if(e.key==='Enter') doLogin(); });

async function loadStore(){
 try{
  var s=await api('/api/store/stats');
  document.getElementById('kpi').innerHTML='<div class="stat"><div class="value">'+(s.totalClients||0)+'</div><div class="label">Clientes de tienda</div></div><div class="stat"><div class="value">'+(s.pendingRegistrations||0)+'</div><div class="label">Pendientes de pago</div></div><div class="stat"><div class="value">'+(s.activeLicenses||0)+'</div><div class="label">Licencias activas</div></div><div class="stat"><div class="value">$'+(s.estimatedRevenue||s.totalLicenses*3||0)+'</div><div class="label">Licencias totales</div></div>';

  // Fallbacks si storeStats endpoint no existe aún (usa admin stats shape)
  var regs=await api('/api/store/registrations');
  var pend=(regs.registrations||[]).filter(function(x){return x.status==='pending'});
  document.getElementById('pendCount').textContent=pend.length;
  document.getElementById('pendList').innerHTML=pend.length?pend.map(function(x){
   return '<div class="list-item"><div class="info"><b>'+esc(x.name)+' '+esc(x.email)+'</b><span>ID: '+esc(String(x.device_id||'').substring(0,22))+'... Plan: '+esc(x.plan)+'m Pago: '+esc(x.payment_method||'-')+(x.receipt_image?' <a href="'+esc(x.receipt_image)+'" target="_blank">Ver comprobante</a>':'')+'</span></div><div class="actions"><button class="btn-sm btn-red" data-action="reject" data-id="'+x.id+'">Rechazar</button><button class="btn-sm btn-green" data-action="approve" data-id="'+x.id+'">Aprobar y Habilitar</button></div></div>';
  }).join(''):'<div class="card-sub">Sin solicitudes pendientes</div>';

  var lic=await api('/api/store/licenses');
  document.getElementById('licList').innerHTML=(lic.licenses||[]).slice(0,10).map(function(x){
   return '<div class="list-item"><div class="info"><b>'+esc(x.code)+'</b><span>'+esc(x.customerName||'')+' '+x.durationMonths+'m $'+x.price+'</span></div><span class="status '+(x.status==='active'?'status-active':'status-pending')+'">'+esc(x.status)+'</span></div>';
  }).join('')||'<div class="card-sub">Sin licencias</div>';

  var users=await api('/api/store/users');
  document.getElementById('cliList').innerHTML=(users.users||[]).slice(0,20).map(function(u){
   return '<div class="list-item"><div class="info"><b>'+esc(u.username)+' ('+esc(u.email)+')</b><span>'+esc(u.name||'')+' — '+esc(u.deviceCount||0)+' disp.</span></div></div>';
  }).join('')||'<div class="card-sub">Sin clientes</div>';

 }catch(e){
  console.error(e);
 }
}

async function approve(id){ try{ var r=await api('/api/store/registrations/'+id+'/approve',{method:'POST'}); alert('APROBADA\nUsuario: '+r.account.username+'\nLicencia: '+r.code); loadStore(); }catch(e){ alert(e.message); } }
async function reject(id){ try{ await api('/api/store/registrations/'+id+'/reject',{method:'POST'}); loadStore(); }catch(e){ alert(e.message); } }
async function genLic(){
 var did=document.getElementById('licDid').value; if(!did) return alert('ID dispositivo requerido');
 try{
  var r=await api('/api/store/licenses/generate',{method:'POST',body:JSON.stringify({deviceId:did, durationMonths:parseInt(document.getElementById('licDur').value), customerName:document.getElementById('licNm').value, customerEmail:document.getElementById('licEm').value})});
  document.getElementById('licRes').innerHTML='<div class="creds">Licencia: <b>'+esc(r.code)+'</b><br>Habilitada y activa.</div>'; loadStore();
 }catch(e){ alert(e.message); }
}
async function regClient(){
 var n=document.getElementById('regNm').value, e=document.getElementById('regEm').value, d=document.getElementById('regDid').value;
 if(!n||!e||!d) return alert('Completa nombre, email y ID dispositivo');
 try{
  var r=await api('/api/register',{method:'POST',body:JSON.stringify({name:n,email:e,phone:document.getElementById('regPh')?.value||'',deviceId:d,plan:parseInt(document.getElementById('regPlan').value)})});
  document.getElementById('regRes').textContent='Solicitud #'+r.registrationId+' creada. Esperando pago/habilitacion.';
  loadStore();
 }catch(x){ document.getElementById('regRes').textContent='Error: '+x.message; }
}

document.addEventListener('click',function(e){
 var t=e.target&&e.target.closest?e.target.closest('[data-action]'):null; if(!t) return;
 var a=t.getAttribute('data-action');
 if(a==='login') doLogin();
 else if(a==='logout') doLogout();
 else if(a==='approve') approve(t.getAttribute('data-id'));
 else if(a==='reject') reject(t.getAttribute('data-id'));
 else if(a==='gen-lic') genLic();
 else if(a==='reg-client') regClient();
});
