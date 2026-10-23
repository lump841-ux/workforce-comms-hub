(function(root,factory){ const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api; else root.TwanovaPractice=api; })(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const fresh=()=>({agency:false,workers:['Maria Lopez'],workerInvite:false,workerActive:false,client:false,clientInvite:false,clientActive:false,shift:false,assigned:false,confirmed:false,status:'scheduled',eta:null,arrived:false,clockedIn:false,onBreak:false,clockedOut:false,photo:false,dispute:'none',reviewed:false,archived:false,replacement:'none',replacementShifts:0,messages:[],done:[],events:[]});
const allow={agency:['setup','add','csv','invite','clientadd','clientinvite','shift','assign','messageEnglish','resolve','archive','replacement','cancelReplacement'],worker:['activateWorker','confirm','way','late','arrive','clockIn','break','back','photo','out','dispute','messageSpanish','emergency','acceptReplacement'],client:['activateClient','messageEnglish','replacement','confirmReplacement','review']};
const eventText={setup:['Sample agency created','Agencia de práctica creada'],add:['Jordan Rivera added','Jordan Rivera agregado'],csv:['Three fictional workers added once','Tres trabajadores ficticios agregados una vez'],invite:['Worker invitation simulated; nothing sent','Invitación simulada; no se envió nada'],clientadd:['Sample client and site added','Cliente y lugar de práctica agregados'],clientinvite:['Client invitation simulated; nothing sent','Invitación del cliente simulada; no se envió nada'],activateWorker:['Sample worker access activated','Acceso de práctica del trabajador activado'],activateClient:['Sample client access activated','Acceso de práctica del cliente activado'],shift:['Sample shift created: Warehouse A, 8 AM–4 PM','Turno de práctica creado: Warehouse A, 8 AM–4 PM'],assign:['Maria assigned to the sample shift','Maria asignada al turno de práctica'],confirm:['Assignment acknowledged','Asignación confirmada'],way:['On my way recorded','En camino registrado'],late:['Sample ETA: 8:20 AM','Hora estimada de práctica: 8:20 AM'],arrive:['Arrival recorded; clock-in is a separate step','Llegada registrada; la entrada es otro paso'],clockIn:['Clock-in recorded','Entrada registrada'],break:['Break started','Descanso iniciado'],back:['Returned from break','Regreso del descanso'],photo:['Sample photo proof simulated; no file uploaded','Foto de práctica simulada; no se subió archivo'],out:['Clock-out recorded','Salida registrada'],dispute:['Sample time problem sent to agency in this simulation','Problema de horas enviado a la agencia en esta simulación'],resolve:['Sample time problem resolved','Problema de horas resuelto'],review:['Sample attendance reviewed','Asistencia de práctica revisada'],archive:['Sample shift archived','Turno de práctica archivado'],emergency:['Sample absence raised on a separate coverage scenario','Ausencia simulada en un escenario separado'],replacement:['Separate sample coverage request opened for Jordan','Solicitud separada de cobertura abierta para Jordan'],acceptReplacement:['Jordan accepted; one replacement assignment created','Jordan aceptó; se creó una asignación de reemplazo'],confirmReplacement:['Client confirmed replacement','Cliente confirmó el reemplazo'],cancelReplacement:['Sample replacement request cancelled','Solicitud de reemplazo cancelada'],messageSpanish:['Prepared Spanish message and sample English translation added','Mensaje preparado en español y traducción de ejemplo agregados'],messageEnglish:['Prepared English reply and sample Spanish translation added','Respuesta preparada en inglés y traducción de ejemplo agregadas']};
const errors={role:['Switch to the correct role for this exercise.','Cambia al rol correcto para este ejercicio.'],setup:['Create the sample agency first.','Primero crea la agencia de práctica.'],workers:['Add Jordan before preparing invitations.','Agrega a Jordan antes de preparar invitaciones.'],invite:['Prepare this role’s sample invitation first.','Primero prepara la invitación de este rol.'],client:['Add the sample client first.','Primero agrega el cliente de práctica.'],shift:['Create a shift first.','Primero crea un turno.'],ready:['Activate both worker and client sample access first.','Primero activa el acceso de práctica del trabajador y del cliente.'],assigned:['Assign Maria and acknowledge the shift first.','Primero asigna a Maria y confirma el turno.'],arrival:['Record arrival first.','Primero registra la llegada.'],clock:['Clock in first.','Primero registra la entrada.'],break:['End the break before clocking out.','Termina el descanso antes de registrar la salida.'],out:['Clock out first.','Primero registra la salida.'],review:['Resolve the time problem and get client review first.','Primero resuelve el problema de horas y consigue la revisión del cliente.'],replacement:['Open a separate coverage request first.','Primero abre una solicitud de cobertura separada.'],replacementClosed:['This coverage request is no longer open. No duplicate assignment was created.','Esta solicitud ya no está abierta. No se creó una asignación duplicada.'],filled:['Worker B must accept this request first.','El trabajador B debe aceptar la solicitud primero.'],already:['This step is already recorded. No duplicate was created.','Este paso ya está registrado. No se creó un duplicado.'],started:['This shift has already started; use break or clock-out actions.','El turno ya empezó; usa descanso o salida.'],closed:['This shift is already clocked out.','Este turno ya terminó.'],notBreak:['There is no active break to end.','No hay un descanso activo para terminar.'],dispute:['Report a sample time problem first.','Primero informa un problema de horas de práctica.']};
function transition(input,role,action){
 const s=JSON.parse(JSON.stringify(input)); const fail=code=>({ok:false,state:input,code,message:errors[code]});
 if(!allow[role]?.includes(action))return fail('role');
 if(action!=='setup'&&!s.agency)return fail('setup');
 const once=['setup','add','csv','invite','clientadd','clientinvite','activateWorker','activateClient','shift','assign','confirm','arrive','clockIn','photo','out','dispute','resolve','review','archive','emergency'];
 if(once.includes(action)&&s.done.includes(action))return fail('already');
 if(['way','late','arrive','clockIn','break','back','photo','out','dispute','emergency'].includes(action)&&(!s.assigned||!s.confirmed))return fail('assigned');
 if(['way','late','arrive','clockIn','break','back','photo','out'].includes(action)&&s.clockedOut)return fail('closed');
 if(['way','late'].includes(action)&&s.clockedIn)return fail('started');
 switch(action){
 case 'setup':s.agency=true;break;
 case 'add':s.workers.push('Jordan Rivera');break;
 case 'csv':for(const n of ['Ana Torres','Carlos Ruiz','Diana Vega'])if(!s.workers.includes(n))s.workers.push(n);break;
 case 'invite':if(!s.workers.includes('Jordan Rivera'))return fail('workers');s.workerInvite=true;break;
 case 'clientadd':s.client=true;break;
 case 'clientinvite':if(!s.client)return fail('client');s.clientInvite=true;break;
 case 'activateWorker':if(!s.workerInvite)return fail('invite');s.workerActive=true;break;
 case 'activateClient':if(!s.clientInvite)return fail('invite');s.clientActive=true;break;
 case 'shift':if(!s.client)return fail('client');s.shift=true;break;
 case 'assign':if(!s.shift)return fail('shift');if(!s.workerActive||!s.clientActive)return fail('ready');s.assigned=true;break;
 case 'confirm':if(!s.assigned)return fail('shift');s.confirmed=true;break;
 case 'way':s.status='on_way';break;
 case 'late':s.status='late';s.eta='8:20 AM';break;
 case 'arrive':s.arrived=true;s.status='arrived';break;
 case 'clockIn':if(!s.arrived)return fail('arrival');s.clockedIn=true;s.status='working';break;
 case 'break':if(!s.clockedIn)return fail('clock');if(s.onBreak)return fail('already');s.onBreak=true;s.status='break';break;
 case 'back':if(!s.onBreak)return fail('notBreak');s.onBreak=false;s.status='working';break;
 case 'photo':if(!s.clockedIn)return fail('clock');s.photo=true;break;
 case 'out':if(!s.clockedIn)return fail('clock');if(s.onBreak)return fail('break');s.clockedOut=true;s.status='out';break;
 case 'dispute':if(!s.clockedOut)return fail('out');s.dispute='open';break;
 case 'resolve':if(s.dispute!=='open')return fail('dispute');s.dispute='resolved';break;
 case 'review':if(!s.clockedOut)return fail('out');if(s.dispute==='open')return fail('review');s.reviewed=true;break;
 case 'archive':if(!s.clockedOut||!s.reviewed||s.dispute==='open')return fail('review');s.archived=true;break;
 case 'emergency':break;
 case 'replacement':if(!s.assigned)return fail('shift');if(s.replacement!=='none')return fail('replacementClosed');s.replacement='open';break;
 case 'acceptReplacement':if(s.replacement==='none')return fail('replacement');if(s.replacement!=='open')return fail('replacementClosed');s.replacement='filled';s.replacementShifts++;break;
 case 'confirmReplacement':if(s.replacement!=='filled')return fail('filled');s.replacement='completed';break;
 case 'cancelReplacement':if(s.replacement!=='open')return fail('replacementClosed');s.replacement='cancelled';break;
 case 'messageSpanish':if(!s.workerActive)return fail('ready');s.messages.push({from:'worker',to:'agency',original:'Voy a llegar 20 minutos tarde.',translation:'I will arrive 20 minutes late.',sample:true});break;
 case 'messageEnglish':if(role==='client'&&!s.clientActive)return fail('ready');s.messages.push({from:role,to:role==='agency'?'worker':'agency',original:'Please use the north entrance.',translation:'Por favor, usa la entrada norte.',sample:true});break;
 }
 if(!s.done.includes(action))s.done.push(action);
 s.events.unshift({role,action,text:eventText[action]});
 return {ok:true,state:s,message:eventText[action]};
}
return {fresh,transition,allow,eventText};
});
