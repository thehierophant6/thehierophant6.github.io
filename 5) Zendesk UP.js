// ==UserScript==
// @name         Zendesk UP with ARCHIVOS (Rename + Auto-Attach) v1.1
// @namespace    https://your-namespace.example
// @version      1.1
// @description  “UP” button for Zendesk: fills fields, inserts branded HTML responses, merges PDFs/images with preview & re-order, renames to reference #, downloads, auto-attaches.
// @match        https://okmobility.zendesk.com/*
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js
// ==/UserScript==

(() => {
  'use strict';

  /************** 1. CONSTANTS & HELPERS *****************************************/
  const SUBJECT_SELECTOR  = '[data-test-id="omni-header-subject"]';
  const REFERENCIA_LABEL  = 'UP - Referencia';
  const TIPOLOGIA_LABEL   = 'Tipología de Reclamación (Retrocesos)';
  const FOOTER_CONTAINER_SELECTOR = '.sc-177ytgv-1.WxSHa';

  const PDF_MIME = 'application/pdf';
  const IMAGE_MIME_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif'];

  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];

  const getSubject   = () => ($(SUBJECT_SELECTOR)?.value.trim() ?? '');
  const extractRef   = t => (/\b(3\d{4,}|7\d{10,})\b/.exec(t)||[])[1]||null;
  const setFieldByLabel = (label,val) => {
    const lab = $$('.sc-kpOJdZ label[data-garden-container-id="containers.field.label"]').find(l=>l.textContent.trim()===label);
    if(!lab) return console.warn(`Label ${label} not found`);
    const inp = document.getElementById(lab.getAttribute('for'));
    if(!inp)  return console.warn(`Input for ${label} missing`);
    inp.value=val; ['input','change'].forEach(e=>inp.dispatchEvent(new Event(e,{bubbles:true})));
  };

  /************** 2. CKEDITOR – simple HTML paste ********************************/
  const setReplyHTML = html => {
    const ed=$('.ck.ck-content[contenteditable="true"]'); if(!ed) return;
    ed.focus(); ed.innerHTML = html;
    ed.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertFromPaste',data:html}));
  };

  /************** 3. REPLY TEMPLATES *********************************************/
  const WRAP_OPEN =
`<div style="max-width:680px;margin:0 auto;background:#fff;padding:30px;font-family:'Nunito',Verdana,sans-serif;font-size:16px;line-height:24px;color:#222;">
  <div style="text-align:center;margin-bottom:30px;">
    <img src="https://okmobility.com/img/new-header/logos/ico-okm.png" alt="OK Mobility" style="width:120px;">
  </div>`;
  const GREET = '<p style="color:#55575d;">Dear Partner,</p>';
  const FAREWELL = '<p style="font-weight:bold;color:#3855e5;">Kind regards,</p>';
  const WRAP_CLOSE='</div>';

  const ACEPTAR_HTML = WRAP_OPEN + GREET +
                       '<p>Thanks for your email.</p><p>We accept the proposed chargeback.</p>' +
                       FAREWELL + WRAP_CLOSE;

  const DEFENDER_OPTIONS = [
    "Cargo – Daños","Cargo - Asistencia","Cargo - Abandono","Cargo – Cancelación NR",
    "Cargo – Limpieza","Cargo – Combustible","Cargo – Kilometraje","Cargo – One Way",
    "Cargo – Fumar","Cargo – After Hours","Cargo – OPC/CAR","Cargo - Upselling",
    "Reserva disfrutada","Reserva NR","Retención"
  ];

  /* ==== FULL SNIPPET MAP (copied verbatim from v1.0) ==== */
  const DEFENDER_SNIPPETS = {   // 15 entries
"Cargo – Daños": `Thank you for reaching out regarding the disputed charge for vehicle damages. We would like to clarify the following points, as set forth in our General Conditions:
1.Coverage Options
-> Additional Coverage (OK PREMIUM COVER or similar): Limits your liability for potential damages.
-> Declining Additional Coverage: Requires a deposit (deductible) ranging from €900 to €4,000 (depending on the vehicle segment), which acts as a guarantee.
2. Deposit and Pre-Authorization
Under point 9 of the General Conditions, customers who do not opt for additional coverage must provide a pre-authorization to cover the deductible and any potential damages. The amount is refunded if the vehicle is returned in the same condition. In the event of new damages, the corresponding charge is deducted from this blocked amount, along with an administrative fee for damage management.
3. Damage Charges
-> Damage Table (Annex): Charges are calculated based on a price table for each affected component, which the customer agrees to upon signing the contract.
-> Vehicle Inspection: We encourage customers to inspect the vehicle at pick-up and report any unrecorded damage. This ensures that only new damages found upon return pertain to the customer’s rental period.
4. Evidence of New Damages
Given the customer’s refusal to acknowledge the charge, we have documented the newly discovered damages with photographs. These images confirm that the damage occurred during the rental period, aligning with our contractual terms.
Please find attached all relevant rental documentation, including the pre-authorization ticket and photos of the vehicle. We remain at your disposal for any additional inquiries.`,
"Cargo - Asistencia": `Referring to the disputed charge for towing/roadside assistance, we would like to clarify the following:
1. Coverage Options and Responsibilities
At the time of rental, customers may opt for specific coverage that includes roadside assistance—such as our Roadside Assistance Service (CAR) or OK SUPER PREMIUM COVER. These coverages typically waive or reduce the customer’s financial liability for certain incidents. However, if the customer did not purchase such coverage or if the incident resulted from negligence or unauthorized use (see point 11 for a more detailed unauthorized use of the vehicle), the cost of the tow truck/road assistance falls entirely on the customer.
2. General Conditions (Point 9 & 9.1.1)
In our General Conditions, particularly point 9 (Coverage) and point 9.1.1 (Roadside Assistance Service – CAR), it is clearly stated that assistance costs may not be covered if the customer has not contracted the corresponding coverage or if the breakdown occurs due to improper or unauthorized use of the vehicle.
3. Customer’s Explicit Agreement
The customer’s signature on the Rental Agreement indicates their acceptance of these conditions, including their responsibility to bear any towing or road assistance costs not covered by the chosen coverage.
4. Supporting Documentation
We have attached copies of the relevant rental documentation (signed agreement and coverage selection), as well as any available service report or invoice detailing the towing/roadside assistance charges.
Should you require more information, we remain at your disposal.`,
"Cargo - Abandono": `Referring to the disputed charge for allegedly abandoning the vehicle, we wish to highlight:
1. Vehicle Return Obligations
Under point 2 of our General Conditions, the Lessee agrees to return (check in) the vehicle at the agreed place and time. If the Lessee fails to return the vehicle as stipulated or leaves it parked or abandoned without properly completing the check-in process, they are liable for the costs related to the vehicle’s recovery.
2. Recovery Fee and Associated Costs
When a vehicle is not returned properly, all recovery and administrative costs fall on the customer, as per the same point in our General Conditions and the applicable fees in our Annex (including potential daily rental charges until the vehicle is retrieved).
3. Customer’s Acceptance
The customer explicitly accepted these contractual obligations upon signing the Rental Agreement. The Terms and Conditions clearly outline that abandoning the vehicle triggers a fee for recovering it, plus any additional expenses.
4. Documentation and Evidence
We have attached the rental documentation and any evidence (e.g., photographs or notes from our recovery team) confirming that the vehicle was not returned correctly, thereby necessitating towing or other recovery measures.
We are available for any further clarifications.`,
"Cargo – Cancelación NR": `Referring to the disputed charge and the customer’s request to refund a non-refundable booking, we would like to clarify:
1. Choice of Non-Refundable Rate
In our General Conditions (point 8.1.4 and reinforced by our Cancellation Policy in point 22), the Lite Rate (or any other non-refundable rate the customer selected) does not admit any reimbursement once the booking is confirmed, unless a strictly documented force majeure situation applies.
2. Customer’s Explicit Consent
By choosing the non-refundable rate, the customer agreed to its conditions:
-> No right to cancellation and no refund.
-> This policy is clearly displayed during the booking process and reiterated in the Rental Agreement.
3. Cancellation/Refund Limitations
In line with point 22 of our General Conditions, all cancellations must be requested in writing, and non-refundable bookings are not subject to reimbursement. Any exception (e.g., force majeure) must be documented and evaluated according to the policy terms.
4. Attached Documentation
We have attached the customer’s signed booking confirmation, which states the rate type and the corresponding non-refundable clause. The booking conditions were accepted by the customer at the time of reservation.
Given these points, we regret to inform you that no refund can be issued for this booking. We remain at your disposal for any questions.`,
"Cargo – Limpieza": `Referring to the disputed cleaning fee charge, please note the following:
1. Condition of the Vehicle Upon Return
According to point 4.2 of our General Conditions, the Lessee is required to return the vehicle in a reasonably clean condition, both inside and outside. If the vehicle is returned requiring extraordinary cleaning (e.g., excessive dirt, garbage, stains, strong odors, etc.), an additional fee is charged.
2. Customer’s Obligation
The customer explicitly accepted these provisions by signing the Rental Agreement. Therefore, any necessary special or additional cleaning that goes beyond normal usage is billed according to our price schedule, which is outlined in the Annex attached to the T&C.
3. Supporting Evidence
We have photographs and/or documentation showing the condition of the vehicle upon return, clearly indicating that additional cleaning services were needed. These are available upon request.
We remain at your disposal for any clarifications.`,
"Cargo – Combustible": `Referring to the disputed charge for fuel, we would like to clarify:
1. Fuel Policy
In compliance with point 14 of our General Conditions, vehicles must be returned with the same fuel level as provided at check-out. Failing to do so may incur refueling costs along with a refueling management fee (stated in our Annex).
2. Customer’s Responsibility
The customer was informed of this policy and acknowledged it upon signing the Rental Agreement. The customer also had the option to choose a “Full/Full” or “Full/Refund” plan, both of which require returning the vehicle with a specified fuel level.
3. Evidence of Shortfall
Our records (fuel gauge reading, pump receipt, photos, etc.) show that the customer returned the car with less fuel than at check-out. Consequently, the agreed fee was applied in accordance with the T&C and as authorized by the customer’s signature.
We stand ready to provide additional details upon request.`,
"Cargo – Kilometraje": `Referring to the disputed charge for exceeding the mileage allowance, we would like to highlight:
1. Mileage Limitation
As stated in point 16 of our General Conditions, the rental agreement includes a daily mileage limit (e.g., 300 km/day, up to a maximum of 3,000 km, or unlimited mileage in certain territories). Exceeding this mileage limit triggers an additional per-kilometer charge, specified in the Annex.
2. Customer’s Agreement
Upon signing the Rental Agreement, the customer acknowledged this limitation. The daily limit or unlimited mileage conditions are clearly indicated in the specific contract details.
3. Exceeding the Allowance
Our vehicle monitoring system and/or returned odometer reading indicate that the customer exceeded the permitted mileage. Hence, the additional mileage fee was applied per the signed contract and T&C.
For more information, we have attached relevant documentation indicating the total kilometers driven during the rental period.`,
"Cargo – One Way": `We are writing concerning the disputed one-way fee charge:
1. Drop-Off Location and Terms
Under point 2 of our General Conditions, the vehicle must be returned to the same Store where the contract was signed, unless a specific “One Way” service was selected and agreed upon. Dropping off the vehicle at a different location without prior authorization is prohibited or subject to additional fees.
2. Customer’s Obligation
The customer had the option to book a permitted One Way service, where an extra fee is applied and included in the Rental Agreement. However, if the customer did not book or pay for One Way and still dropped the vehicle at another location, they are liable for the corresponding penalty or recovery costs.
3. Contractual Acceptance
By signing the Rental Agreement, the customer accepted all obligations related to the return location. Therefore, the additional charge is valid according to the T&C and the Annex fee schedule.
Please find attached the relevant documentation confirming the drop-off location and the associated fee details.`,
"Cargo – Fumar": `In response to the disputed smoking fee charge, we offer the following clarification:
1. Non-Smoking Policy
As stated in point 11 of our General Conditions, smoking inside the vehicle is strictly prohibited. Doing so may result in a penalty or a special cleaning charge to remove odors and residues.
2. Inspection Findings
Upon returning the vehicle, our inspection found clear evidence of smoking (e.g., smell of tobacco, ash traces, cigarette burns). As per the T&C and the Annex, the associated fee is assessed for additional cleaning and decontamination.
3. Customer’s Acceptance
The customer explicitly accepted these terms upon signing the contract. Therefore, the fee is charged in accordance with the T&C to restore the vehicle to its non-smoking condition.`,
"Cargo – After Hours": `Regarding the disputed after-hours charge, we would like to outline the following:
1. Pickup and Return Schedule
In point 2.3 of our General Conditions, it is specified that any check-in or check-out of the vehicle outside the Store’s regular opening hours incurs an additional fee. This cost is detailed in the Annex.
2. Customer’s Advance Notice
The customer was informed of our store’s operating hours and the associated fees for requesting an out-of-hours service. By confirming the reservation and signing the agreement, the customer consented to these terms.
3. Justification of Charge
Our records indicate the vehicle was picked up or returned outside normal operating hours, thereby necessitating staff availability beyond our standard schedule. Hence, we applied the corresponding surcharge in line with the T&C.`,
"Cargo – OPC/CAR": `Referring to the disputed charges for additional coverage (OK PREMIUM COVER and/or Roadside Assistance), please consider:
1. Coverage Terms
Point 9 of our General Conditions details the coverage options available to customers, including potential waivers of the excess, roadside assistance benefits, etc.
2. Voluntary Selection & Usage
The customer voluntarily selected and enjoyed these additional coverages during the rental period. Once activated and used, these services are non-refundable—even if the customer did not file a claim. If no cover has been added, a pre-authorised amount (excess) will be blocked on a physical credit card (card must belong to the driver named in the contract), this amount can vary between 900 EUR and 4000 EUR.
Therefore, as specified in Point 9 of the General Conditions, when the optional OK PREMIUM COVER is not contracted, the customer must present a physical credit card in the name of the reservation holder to place a pre-authorization hold for the applicable damage excess. Failure to meet this requirement may result in the inability to provide the rental vehicle.
3. Non-Refundable Policy
Our T&C clearly specify that coverage costs apply for the entire rental period; there is no partial or full refund if the coverage has been in effect for any or all of the rental duration.
4. Customer Acknowledgment
By signing the Rental Agreement, the customer acknowledged and agreed to pay for these coverage services in full.
Consequently, the charge in question is legitimate under our contractual terms.`,
"Cargo - Upselling": `Regarding the disputed charge for an upgraded (higher category) vehicle, our records indicate the following:
1. Voluntary Upgrade
According to our documentation, you were offered a higher category vehicle at an additional cost. By signing the contract and entering your payment PIN, you explicitly accepted this upgrade and its corresponding charges.
2. Fleet Availability
Under our General Conditions, if a fleet shortage or lack of availability occurs in the vehicle category originally reserved, we provide a vehicle of a higher category free of charge. However, in this instance, we have no record of such a shortage. Instead, the upgrade was a voluntary choice on your part. Please note that we give 4 hours of courtesy to our customers o pick up the vehicles, if the office hours allow it. After this period, the reservation is subject to availability and a charge of 50€ for reactivation of reservation.
“2.2. Late Pickup: Within the "check-out" schedule of the OK Mobility reservation, a grace period of 4 hours will be granted for the vehicle pickup at no additional cost. Once the courtesy period has elapsed, the lessee will have the possibility to reactivate their reservation within a maximum period of 48 hours from the "check out" time of the reservation, and always subject to availability and store hours. Reactivating the reservation will incur an additional surcharge by the customer unless specific conditions specify otherwise. The cost for this service is detailed in the attached Annex.”
3. Non-Refundable Once Used
Since you enjoyed the upgraded vehicle throughout your rental period, we regret to inform you that no reimbursement is applicable for services already provided and utilized.
We apologize for any inconvenience caused. Should you have any further questions or require additional information, we remain at your disposal.`,
"Reserva disfrutada": `We are writing regarding the customer’s refund request for a reservation that was fully used:
1. Service Fulfillment
According to our records and rental documentation, the customer proceeded with vehicle pickup (Check-Out) and utilized the booked rental. Therefore, the service was rendered in full, as outlined in point 2 of our General Conditions regarding the rental period and proper Check-In/Check-Out procedures.
2. Completion of Contract
Once a reservation has been honored and the vehicle has been used, the full rental contract and its corresponding terms apply. As stated in point 8 of our T&C, all agreed-upon charges for the reserved period become due when the service is provided.
3. No Grounds for Refund
In alignment with point 22 (Cancellation Policy), refunds may be considered only before or at the start of the rental period for specific rate types (e.g., Premium Rate or Standard Rate, under certain conditions). However, in this case, the reservation has been fulfilled with the vehicle in use, thus no refund is applicable.
4. Customer’s Agreement
By signing the Rental Agreement and utilizing the booking, the customer accepted these terms. We have attached all supporting documentation, including the signed contract and usage records.
We trust this clarifies the reason no refund can be issued. We remain at your disposal for any further questions.`,
"Reserva NR": `We refer to the customer’s request to cancel a non-refundable booking. Below are the relevant points:
1. Non-Refundable Rate Selection
In point 8.1.4 of our General Conditions, it specifies our Lite Rate (or another designated non-refundable rate) does not permit refunds or changes once the booking is confirmed.
2. Cancellation Policy
As highlighted in point 22 (Cancellation Policy) of the T&C, no refunds are issued for non-refundable bookings. This is clearly indicated at the time of reservation and accepted by the customer when finalizing the booking.
3. Explicit Acknowledgment
During the reservation process (either online or in-store), the customer was informed of the non-refundable nature of this rate. Proceeding with the booking means the customer explicitly agreed to these terms.
4. Documentation
Please see attached the booking confirmation and rate details reflecting the non-refundable policy and the customer’s acceptance.
In light of the above, we regret that no refund can be issued. We are available for any additional clarification.`,
"Retención": `Regarding the customer’s concern over the preauthorized (blocked) amount on their payment card:
1. Excess/Deposit Policy
Point 9 and 9.2 of our General Conditions establish that, when no additional coverage or partial coverage is chosen, a security deposit (or excess) preauthorization ranging from €900 to €4,000 is placed on the customer’s credit card according to the vehicle’s group/segment.
2. Purpose of the Preauthorization
The deposit acts as a guarantee to cover potential damages, traffic penalties, refueling, or any other charges identified at the vehicle’s return. Once the rental concludes and if no incident is detected, point 9.2 clarifies that the withheld or blocked amount is automatically released.
3. Release of Funds
Our records show that after the vehicle’s check-in and inspection, no additional charges were identified. Therefore, we promptly initiated the release of the preauthorized amount. The timeline for the funds to appear back on the customer’s account depends on their bank’s processing times.
4. Customer Authorization
The customer agreed to the deposit block by signing the Rental Agreement, which includes a clear explanation in the T&C regarding the preauthorization and subsequent release process.
Please see the attached documentation, including the signed rental contract and proof of the deposit release.`
  }; /* === END SNIPPETS === */

  const buildDefenderHTML = causes =>
    WRAP_OPEN + GREET +
    causes.map(c=>`<h3 style="color:#3855e5;margin:24px 0 8px;">${c}</h3><p style="white-space:pre-line;">${DEFENDER_SNIPPETS[c]}</p>`).join('') +
    FAREWELL + WRAP_CLOSE;

  /************** 4. MULTI-SELECT POPUP ***************************************/
  const pickCauses = () => new Promise(ok=>{
    const ov = Object.assign(document.createElement('div'),{style:'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99999;display:flex;align-items:center;justify-content:center'});
    const box=Object.assign(document.createElement('div'),{style:'background:#fff;padding:20px;border-radius:8px;width:460px;max-height:80%;overflow:auto;font-family:Arial'});
    box.innerHTML='<h2>Select cause(s)</h2><p style="font-size:14px;margin-top:-10px;">First selected cause is copied to “Tipología”.</p>';
    const list=document.createElement('div'); box.append(list);
    DEFENDER_OPTIONS.forEach(o=>{
      const lab=document.createElement('label'); lab.style.display='block'; lab.style.marginBottom='6px';
      lab.innerHTML=`<input type="checkbox" value="${o}" style="margin-right:8px;transform:scale(1.2);"> ${o}`; list.append(lab);
    });
    const btn=document.createElement('button'); btn.textContent='Confirm'; btn.style.marginTop='10px';
    btn.onclick=()=>{ok([...list.querySelectorAll('input:checked')].map(i=>i.value)); ov.remove();};
    box.append(btn); ov.append(box); document.body.append(ov);
  });

  /************** 5. PDF-LIB helpers *******************************************/
  const pdfReady = () => new Promise(r=>{(function c(){(window.PDFLib&&window.PDFLib.PDFDocument)?r():setTimeout(c,100)})();});
  const mergePDF = async arr=>{
    await pdfReady(); const {PDFDocument}=window.PDFLib; const out=await PDFDocument.create();
    for(const {file,ab} of arr){
      if(file.type===PDF_MIME){
        const src=await PDFDocument.load(ab); const pages=await out.copyPages(src,src.getPageIndices()); pages.forEach(p=>out.addPage(p));
      }else{
        const img=file.type.endsWith('png')?await out.embedPng(ab):await out.embedJpg(ab);
        const {width,height}=img.scale(1); const pg=out.addPage([width,height]); pg.drawImage(img,{x:0,y:0,width,height});
      }
    }
    return out.save();
  };

  /************** 6. ARCHIVOS modal (preview + drag reorder) *******************/
  const openArchivos = ref=>{
    /* style */
    const css=`#archOv{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999999;display:flex;align-items:center;justify-content:center}
#archMd{background:#fff;padding:20px;border-radius:8px;width:440px;max-height:90%;overflow:hidden;display:flex;flex-direction:column}
#dragZ{border:2px dashed #ccc;padding:18px;text-align:center;margin-bottom:14px;cursor:pointer}
#fList{flex:1;overflow:auto;margin-bottom:16px}
.item{display:flex;align-items:center;border:1px solid #e0e0e0;background:#fafafa;margin-bottom:6px;padding:6px;border-radius:4px;cursor:grab}
.item.dragging{opacity:.4}
.item img{width:40px;height:40px;object-fit:cover;margin-right:10px;border-radius:3px}
.item span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}`; document.head.append(Object.assign(document.createElement('style'),{textContent:css}));
    /* DOM */
    const ov=Object.assign(document.createElement('div'),{id:'archOv'});
    const md=Object.assign(document.createElement('div'),{id:'archMd'});
    const dz=Object.assign(document.createElement('div'),{id:'dragZ',textContent:'Drag & drop or click'});
    const inp=Object.assign(document.createElement('input'),{type:'file',multiple:true,accept:'.pdf,image/*',style:'display:none'});
    const list=Object.assign(document.createElement('div'),{id:'fList'});
    const foot=document.createElement('div'); const go=document.createElement('button'); go.textContent='Merge & Attach'; const cls=document.createElement('button'); cls.textContent='Close'; foot.append(go,cls);
    md.append(dz,list,inp,foot); ov.append(md); document.body.append(ov);
    /* data */
    let files=[],dragSrc;
    const redraw=()=>{list.innerHTML=''; files.forEach(({file,thumb},i)=>{const it=Object.assign(document.createElement('div'),{className:'item',draggable:true,dataset:{i}});
      const img=document.createElement('img'); img.src=thumb||'https://cdn.jsdelivr.net/gh/feathericons/feather/icons/file.svg';
      const sp=document.createElement('span'); sp.textContent=file.name; it.append(img,sp); list.append(it);});};
    const add=async fl=>{for(const f of fl){if(!(f.type===PDF_MIME||IMAGE_MIME_TYPES.includes(f.type))){alert(`Skip ${f.name}`);continue;}
      files.push({file:f,ab:await f.arrayBuffer(),thumb:IMAGE_MIME_TYPES.includes(f.type)?URL.createObjectURL(f):''});} redraw();};
    dz.onclick=()=>inp.click(); inp.onchange=e=>add(e.target.files);
    ['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor='#008CBA';}));
    ['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor='#ccc';}));
    dz.ondrop=e=>add(e.dataTransfer.files);
    /* reorder */
    list.addEventListener('dragstart',e=>{dragSrc=+e.target.dataset.i; e.target.classList.add('dragging');});
    list.addEventListener('dragend',e=>e.target.classList.remove('dragging'));
    list.addEventListener('dragover',e=>e.preventDefault());
    list.addEventListener('drop',e=>{const tgt=+e.target.closest('.item').dataset.i; if(dragSrc===tgt)return; const mv=files.splice(dragSrc,1)[0]; files.splice(tgt,0,mv); redraw();});
    /* buttons */
    cls.onclick=()=>ov.remove();
    go.onclick=async()=>{if(!files.length){alert('Add files first');return;} const bytes=await mergePDF(files);
      const name=(ref||'merged_files')+'.pdf',blob=new Blob([bytes],{type:PDF_MIME}),url=URL.createObjectURL(blob);
      Object.assign(document.createElement('a'),{href:url,download:name}).click(); URL.revokeObjectURL(url);
      const comp=$('.ck.ck-content[contenteditable="true"]'); if(comp){const dt=new DataTransfer(); dt.items.add(new File([blob],name,{type:PDF_MIME}));
        comp.dispatchEvent(new DragEvent('drop',{bubbles:true,composed:true,dataTransfer:dt}));}
      ov.remove();};
  };

  /************** 7. BUTTON BAR *************************************************/
  const injectButtons = ()=>{
    if($('#btnUP')) return;
    const f=$(FOOTER_CONTAINER_SELECTOR); if(!f) return;
    const mk=(id,txt,bg)=>Object.assign(document.createElement('button'),{id,textContent:txt,style:`background:${bg};color:#fff;border:none;padding:6px 12px;margin-right:6px;cursor:pointer`});
    const up=mk('btnUP','UP','#008CBA'), ac=mk('btnAC','ACEPTAR','#4CAF50'), df=mk('btnDF','DEFENDER','#f44336'), ar=mk('btnAR','ARCHIVOS','#9C27B0');
    [ac,df,ar].forEach(b=>b.style.display='none'); f.prepend(df,ac,ar,up);
    up.onclick=()=>{const show=ac.style.display==='none'; [ac,df,ar].forEach(b=>b.style.display=show?'inline-block':'none');};
    ar.onclick=()=>openArchivos(extractRef(getSubject()));
    ac.onclick=async()=>{
      const ref=extractRef(getSubject()); if(!ref){alert('Ref missing');return;}
      setFieldByLabel(REFERENCIA_LABEL,ref); const c=await pickCauses(); if(c && c.length) setFieldByLabel(TIPOLOGIA_LABEL,c[0]);
      setReplyHTML(ACEPTAR_HTML);
    };
    df.onclick=async()=>{
      const ref=extractRef(getSubject()); if(!ref){alert('Ref missing');return;}
      setFieldByLabel(REFERENCIA_LABEL,ref); const c=await pickCauses(); if(!c.length){alert('Choose a cause');return;}
      setFieldByLabel(TIPOLOGIA_LABEL,c[0]); setReplyHTML(buildDefenderHTML(c));
    };
  };
  const timer=setInterval(()=>{injectButtons(); if($('#btnUP')) clearInterval(timer);},1500);
})();
