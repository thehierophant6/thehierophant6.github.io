// ==UserScript==
// @name         Zendesk UP with ARCHIVOS (Rename + Auto-Attach)
// @namespace    https://your-namespace.example
// @version      1.0
// @description  "UP" button for Zendesk. Merges PDFs/images, renames the file to the reference #, downloads, and auto-attaches to composer by simulating a drag/drop event.
// @match        https://okmobility.zendesk.com/*
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js
// ==/UserScript==

(function() {
  'use strict';

  /***************************************************************/
  /*** 1) SUBJECT & FIELDS: "UP - Referencia" / "Tipología"    ***/
  /***************************************************************/
  const SUBJECT_SELECTOR = '[data-test-id="omni-header-subject"]';
  const REFERENCIA_LABEL = 'UP - Referencia';
  const TIPOLOGIA_LABEL = 'Tipología de Reclamación (Retrocesos)';

  function getTicketSubject() {
    const el = document.querySelector(SUBJECT_SELECTOR);
    return el ? el.value.trim() : '';
  }

  /**
   * Extract either:
   *  - "3" + >=4 digits (like 35678), or
   *  - "7" + >=10 digits (like 71234567890)
   */
  function extractRefNumber(text) {
    const re = /\b(3\d{4,}|7\d{10,})\b/;
    const match = re.exec(text);
    return match ? match[1] : null;
  }

  function setTextFieldByLabel(labelText, newValue) {
    const labels = document.querySelectorAll('label[data-garden-container-id="containers.field.label"]');
    const label = [...labels].find(lbl => lbl.textContent.trim() === labelText);
    if (!label) {
      console.warn(`Label "${labelText}" not found!`);
      return;
    }
    const forId = label.getAttribute('for');
    if (!forId) {
      console.warn(`Label "${labelText}" has no "for" attribute`);
      return;
    }
    const input = document.getElementById(forId);
    if (!input) {
      console.warn(`No input found for label "${labelText}". id=${forId}`);
      return;
    }
    input.value = newValue;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /***************************************************************/
  /*** 2) CKEDITOR LINE-BY-LINE TEXT INSERT (Tribute.js style) ***/
  /***************************************************************/
  function setReplyText(fullMessage, isHTML = false) {
    const editorDiv = document.querySelector('.ck.ck-content[contenteditable="true"]');
    if (!editorDiv) {
      console.warn('No CKEditor editor found. Cannot paste text lines.');
      return;
    }
    editorDiv.focus();
    
    if (isHTML) {
      // For HTML content, we'll use the clipboard API which works better with CKEditor
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = fullMessage;
      
      // Create a new clipboard event
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', fullMessage);
      clipboardData.setData('text/plain', tempDiv.textContent);
      
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboardData
      });
      
      // Dispatch the paste event
      editorDiv.dispatchEvent(pasteEvent);
      
      // If the paste event doesn't work, fallback to insertHTML command if available
      try {
        if (!pasteEvent.defaultPrevented) {
          document.execCommand('insertHTML', false, fullMessage);
        }
      } catch (e) {
        console.warn('Failed to insert HTML via execCommand:', e);
        // Last resort fallback: direct innerHTML (may not trigger proper CKEditor events)
        editorDiv.innerHTML = fullMessage;
      }
    } else {
      // Original line-by-line plain text handling
      fullMessage = fullMessage.replace(/\r\n/g, '\n');
      const lines = fullMessage.split('\n');
      for (let i = 0; i < lines.length; i++) {
        insertTextInCKEditor(editorDiv, lines[i]);
        if (i < lines.length - 1) {
          insertTextInCKEditor(editorDiv, '\n');
        }
      }
    }

    editorDiv.blur();
    setTimeout(() => editorDiv.focus(), 50);
  }

  function insertTextInCKEditor(editorDiv, chunk) {
    const range = document.createRange();
    if (editorDiv.lastChild) {
      range.setStartAfter(editorDiv.lastChild);
      range.setEndAfter(editorDiv.lastChild);
    } else {
      range.setStart(editorDiv, 0);
      range.setEnd(editorDiv, 0);
    }
    const staticRange = new StaticRange({
      startContainer: range.startContainer,
      startOffset:   range.startOffset,
      endContainer:  range.endContainer,
      endOffset:     range.endOffset
    });

    // "beforeinput"
    const beforeEvt = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: chunk
    });
    Object.defineProperty(beforeEvt, 'getTargetRanges', {
      configurable: true,
      value: () => [staticRange]
    });
    editorDiv.dispatchEvent(beforeEvt);

    // Insert text node
    const textNode = document.createTextNode(chunk);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);

    // "input"
    const inputEvt = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: 'insertText',
      data: chunk
    });
    Object.defineProperty(inputEvt, 'getTargetRanges', {
      configurable: true,
      value: () => [staticRange]
    });
    editorDiv.dispatchEvent(inputEvt);
  }

  /***********************************************/
  /*** 3) SINGLE GREETING / FAREWELL + SNIPPETS ***/
  const ACEPTAR_TEXT_PLAIN = [
    "Dear Partner,",
    "",
    "Thanks for your email.",
    "",
    "We accept the proposed chargeback."
  ].join('\n');
  
  // New HTML styled ACEPTAR text
  const ACEPTAR_TEXT_HTML = `
  <div style="font-family:'Nunito',Verdana,sans-serif;font-size:14px;line-height:1.5;color:#333;">
    <p>Dear Partner,</p>
    <p>Thanks for your email.</p>
    <p style="font-weight:bold;color:#4CAF50;">We accept the proposed chargeback.</p>
    <p style="margin-top:20px;">Kind regards,</p>
  </div>
  `;

  // For backward compatibility, define ACEPTAR_TEXT
  const ACEPTAR_TEXT = ACEPTAR_TEXT_PLAIN;

  const GREETING = "Dear Partner,";
  const FAREWELL = "Kind regards,";

  const DEFENDER_OPTIONS = [
    "Cargo – Daños",
    "Cargo - Asistencia",
    "Cargo - Abandono",
    "Cargo – Cancelación NR",
    "Cargo – Limpieza",
    "Cargo – Combustible",
    "Cargo – Kilometraje",
    "Cargo – One Way",
    "Cargo – Fumar",
    "Cargo – After Hours",
    "Cargo – OPC/CAR",
    "Cargo - Upselling",
    "Reserva disfrutada",
    "Reserva NR",
    "Retención"
  ];

  // Create HTML templates for defender snippets
  function createHTMLSnippet(title, content) {
    // Format the content: identify numbered points and create proper HTML structure
    let formattedContent = content;
    
    // Replace numbered points with bold headings
    formattedContent = formattedContent.replace(/(\d+\.\s+)([^\n]+)/g, '<h3 style="margin:15px 0 5px;color:#3855e5;font-size:15px;">$1$2</h3>');
    
    // Replace arrow points with list items
    formattedContent = formattedContent.replace(/(->\s+)([^\n]+)/g, '<li>$2</li>');
    
    // Wrap lists in <ul> tags
    if (formattedContent.includes('<li>')) {
      formattedContent = formattedContent.replace(/(<li>.*?<\/li>)/gs, '<ul style="margin:5px 0 15px 20px;padding-left:10px;">$1</ul>');
    }
    
    // Convert regular paragraphs
    formattedContent = formattedContent.replace(/^(?!<h3|<ul|<\/ul>)(.+)$/gm, '<p>$1</p>');
    
    return formattedContent;
  }

  const DEFENDER_SNIPPETS = {
"Cargo – Daños": `Thank you for reaching out regarding the disputed charge for vehicle damages. We would like to clarify the following points, as set forth in our General Conditions:
1.Coverage Options
-> Additional Coverage (OK PREMIUM COVER or similar): Limits your liability for potential damages.
-> Declining Additional Coverage: Requires a deposit (deductible) ranging from €900 to €4,000 (depending on the vehicle segment), which acts as a guarantee.
2. Deposit and Pre-Authorization
Under point 9 of the General Conditions, customers who do not opt for additional coverage must provide a pre-authorization to cover the deductible and any potential damages. The amount is refunded if the vehicle is returned in the same condition. In the event of new damages, the corresponding charge is deducted from this blocked amount, along with an administrative fee for damage management.
3. Damage Charges
-> Damage Table (Annex): Charges are calculated based on a price table for each affected component, which the customer agrees to upon signing the contract.
-> Vehicle Inspection: We encourage customers to inspect the vehicle at pick-up and report any unrecorded damage. This ensures that only new damages found upon return pertain to the customer's rental period.
4. Evidence of New Damages
Given the customer's refusal to acknowledge the charge, we have documented the newly discovered damages with photographs. These images confirm that the damage occurred during the rental period, aligning with our contractual terms.
Please find attached all relevant rental documentation, including the pre-authorization ticket and photos of the vehicle. We remain at your disposal for any additional inquiries.
`.trim(),

    "Cargo - Asistencia": `Referring to the disputed charge for towing/roadside assistance, we would like to clarify the following:
1. Coverage Options and Responsibilities
At the time of rental, customers may opt for specific coverage that includes roadside assistance—such as our Roadside Assistance Service (CAR) or OK SUPER PREMIUM COVER. These coverages typically waive or reduce the customer's financial liability for certain incidents. However, if the customer did not purchase such coverage or if the incident resulted from negligence or unauthorized use (see point 11 for a more detailed unauthorized use of the vehicle), the cost of the tow truck/road assistance falls entirely on the customer.
2. General Conditions (Point 9 & 9.1.1)
In our General Conditions, particularly point 9 (Coverage) and point 9.1.1 (Roadside Assistance Service – CAR), it is clearly stated that assistance costs may not be covered if the customer has not contracted the corresponding coverage or if the breakdown occurs due to improper or unauthorized use of the vehicle.
3. Customer's Explicit Agreement
The customer's signature on the Rental Agreement indicates their acceptance of these conditions, including their responsibility to bear any towing or road assistance costs not covered by the chosen coverage.
4. Supporting Documentation
We have attached copies of the relevant rental documentation (signed agreement and coverage selection), as well as any available service report or invoice detailing the towing/roadside assistance charges.
Should you require more information, we remain at your disposal.
`.trim(),

    "Cargo - Abandono": `Referring to the disputed charge for allegedly abandoning the vehicle, we wish to highlight:
1. Vehicle Return Obligations
Under point 2 of our General Conditions, the Lessee agrees to return (check in) the vehicle at the agreed place and time. If the Lessee fails to return the vehicle as stipulated or leaves it parked or abandoned without properly completing the check-in process, they are liable for the costs related to the vehicle's recovery.
2. Recovery Fee and Associated Costs
When a vehicle is not returned properly, all recovery and administrative costs fall on the customer, as per the same point in our General Conditions and the applicable fees in our Annex (including potential daily rental charges until the vehicle is retrieved).
3. Customer's Acceptance
The customer explicitly accepted these contractual obligations upon signing the Rental Agreement. The Terms and Conditions clearly outline that abandoning the vehicle triggers a fee for recovering it, plus any additional expenses.
4. Documentation and Evidence
We have attached the rental documentation and any evidence (e.g., photographs or notes from our recovery team) confirming that the vehicle was not returned correctly, thereby necessitating towing or other recovery measures.
We are available for any further clarifications.
`.trim(),

    "Cargo – Cancelación NR": `Referring to the disputed charge and the customer's request to refund a non-refundable booking, we would like to clarify:
1. Choice of Non-Refundable Rate
In our General Conditions (point 8.1.4 and reinforced by our Cancellation Policy in point 22), the Lite Rate (or any other non-refundable rate the customer selected) does not admit any reimbursement once the booking is confirmed, unless a strictly documented force majeure situation applies.
2. Customer's Explicit Consent
By choosing the non-refundable rate, the customer agreed to its conditions:
-> No right to cancellation and no refund.
-> This policy is clearly displayed during the booking process and reiterated in the Rental Agreement.
3. Cancellation/Refund Limitations
In line with point 22 of our General Conditions, all cancellations must be requested in writing, and non-refundable bookings are not subject to reimbursement. Any exception (e.g., force majeure) must be documented and evaluated according to the policy terms.
4. Attached Documentation
We have attached the customer's signed booking confirmation, which states the rate type and the corresponding non-refundable clause. The booking conditions were accepted by the customer at the time of reservation.
Given these points, we regret to inform you that no refund can be issued for this booking. We remain at your disposal for any questions.
`.trim(),

    "Cargo – Limpieza": `Referring to the disputed cleaning fee charge, please note the following:
1. Condition of the Vehicle Upon Return
According to point 4.2 of our General Conditions, the Lessee is required to return the vehicle in a reasonably clean condition, both inside and outside. If the vehicle is returned requiring extraordinary cleaning (e.g., excessive dirt, garbage, stains, strong odors, etc.), an additional fee is charged.
2. Customer's Obligation
The customer explicitly accepted these provisions by signing the Rental Agreement. Therefore, any necessary special or additional cleaning that goes beyond normal usage is billed according to our price schedule, which is outlined in the Annex attached to the T&C.
3. Supporting Evidence
We have photographs and/or documentation showing the condition of the vehicle upon return, clearly indicating that additional cleaning services were needed. These are available upon request.
We remain at your disposal for any clarifications.
`.trim(),

    "Cargo – Combustible": `Referring to the disputed charge for fuel, we would like to clarify:
1. Fuel Policy
In compliance with point 14 of our General Conditions, vehicles must be returned with the same fuel level as provided at check-out. Failing to do so may incur refueling costs along with a refueling management fee (stated in our Annex).
2. Customer's Responsibility
The customer was informed of this policy and acknowledged it upon signing the Rental Agreement. The customer also had the option to choose a "Full/Full" or "Full/Refund" plan, both of which require returning the vehicle with a specified fuel level.
3. Evidence of Shortfall
Our records (fuel gauge reading, pump receipt, photos, etc.) show that the customer returned the car with less fuel than at check-out. Consequently, the agreed fee was applied in accordance with the T&C and as authorized by the customer's signature.
We stand ready to provide additional details upon request.
`.trim(),

    "Cargo – Kilometraje": `Referring to the disputed charge for exceeding the mileage allowance, we would like to highlight:
1. Mileage Limitation
As stated in point 16 of our General Conditions, the rental agreement includes a daily mileage limit (e.g., 300 km/day, up to a maximum of 3,000 km, or unlimited mileage in certain territories). Exceeding this mileage limit triggers an additional per-kilometer charge, specified in the Annex.
2. Customer's Agreement
Upon signing the Rental Agreement, the customer acknowledged this limitation. The daily limit or unlimited mileage conditions are clearly indicated in the specific contract details.
3. Exceeding the Allowance
Our vehicle monitoring system and/or returned odometer reading indicate that the customer exceeded the permitted mileage. Hence, the additional mileage fee was applied per the signed contract and T&C.
For more information, we have attached relevant documentation indicating the total kilometers driven during the rental period.
`.trim(),

    "Cargo – One Way": `We are writing concerning the disputed one-way fee charge:
1. Drop-Off Location and Terms
Under point 2 of our General Conditions, the vehicle must be returned to the same Store where the contract was signed, unless a specific "One Way" service was selected and agreed upon. Dropping off the vehicle at a different location without prior authorization is prohibited or subject to additional fees.
2. Customer's Obligation
The customer had the option to book a permitted One Way service, where an extra fee is applied and included in the Rental Agreement. However, if the customer did not book or pay for One Way and still dropped the vehicle at another location, they are liable for the corresponding penalty or recovery costs.
3. Contractual Acceptance
By signing the Rental Agreement, the customer accepted all obligations related to the return location. Therefore, the additional charge is valid according to the T&C and the Annex fee schedule.
Please find attached the relevant documentation confirming the drop-off location and the associated fee details.
`.trim(),

    "Cargo – Fumar": `In response to the disputed smoking fee charge, we offer the following clarification:
1. Non-Smoking Policy
As stated in point 11 of our General Conditions, smoking inside the vehicle is strictly prohibited. Doing so may result in a penalty or a special cleaning charge to remove odors and residues.
2. Inspection Findings
Upon returning the vehicle, our inspection found clear evidence of smoking (e.g., smell of tobacco, ash traces, cigarette burns). As per the T&C and the Annex, the associated fee is assessed for additional cleaning and decontamination.
3. Customer's Acceptance
The customer explicitly accepted these terms upon signing the contract. Therefore, the fee is charged in accordance with the T&C to restore the vehicle to its non-smoking condition.
`.trim(),

    "Cargo – After Hours": `Regarding the disputed after-hours charge, we would like to outline the following:
1. Pickup and Return Schedule
In point 2.3 of our General Conditions, it is specified that any check-in or check-out of the vehicle outside the Store's regular opening hours incurs an additional fee. This cost is detailed in the Annex.
2. Customer's Advance Notice
The customer was informed of our store's operating hours and the associated fees for requesting an out-of-hours service. By confirming the reservation and signing the agreement, the customer consented to these terms.
3. Justification of Charge
Our records indicate the vehicle was picked up or returned outside normal operating hours, thereby necessitating staff availability beyond our standard schedule. Hence, we applied the corresponding surcharge in line with the T&C.
`.trim(),

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
Consequently, the charge in question is legitimate under our contractual terms.
`.trim(),

    "Cargo - Upselling": `Regarding the disputed charge for an upgraded (higher category) vehicle, our records indicate the following:
1. Voluntary Upgrade
According to our documentation, you were offered a higher category vehicle at an additional cost. By signing the contract and entering your payment PIN, you explicitly accepted this upgrade and its corresponding charges.
2. Fleet Availability
Under our General Conditions, if a fleet shortage or lack of availability occurs in the vehicle category originally reserved, we provide a vehicle of a higher category free of charge. However, in this instance, we have no record of such a shortage. Instead, the upgrade was a voluntary choice on your part. Please note that we give 4 hours of courtesy to our customers o pick up the vehicles, if the office hours allow it. After this period, the reservation is subject to availability and a charge of 50€ for reactivation of reservation.
"2.2. Late Pickup: Within the "check-out" schedule of the OK Mobility reservation, a grace period of 4 hours will be granted for the vehicle pickup at no additional cost. Once the courtesy period has elapsed, the lessee will have the possibility to reactivate their reservation within a maximum period of 48 hours from the "check out" time of the reservation, and always subject to availability and store hours. Reactivating the reservation will incur an additional surcharge by the customer unless specific conditions specify otherwise. The cost for this service is detailed in the attached Annex.
3. Non-Refundable Once Used
Since you enjoyed the upgraded vehicle throughout your rental period, we regret to inform you that no reimbursement is applicable for services already provided and utilized.
We apologize for any inconvenience caused. Should you have any further questions or require additional information, we remain at your disposal.
`.trim(),

    "Reserva disfrutada": `We are writing regarding the customer's refund request for a reservation that was fully used:
1. Service Fulfillment
According to our records and rental documentation, the customer proceeded with vehicle pickup (Check-Out) and utilized the booked rental. Therefore, the service was rendered in full, as outlined in point 2 of our General Conditions regarding the rental period and proper Check-In/Check-Out procedures.
2. Completion of Contract
Once a reservation has been honored and the vehicle has been used, the full rental contract and its corresponding terms apply. As stated in point 8 of our T&C, all agreed-upon charges for the reserved period become due when the service is provided.
3. No Grounds for Refund
In alignment with point 22 (Cancellation Policy), refunds may be considered only before or at the start of the rental period for specific rate types (e.g., Premium Rate or Standard Rate, under certain conditions). However, in this case, the reservation has been fulfilled with the vehicle in use, thus no refund is applicable.
4. Customer's Agreement
By signing the Rental Agreement and utilizing the booking, the customer accepted these terms. We have attached all supporting documentation, including the signed contract and usage records.
We trust this clarifies the reason no refund can be issued. We remain at your disposal for any further questions.
`.trim(),

    "Reserva NR": `We refer to the customer's request to cancel a non-refundable booking. Below are the relevant points:
1. Non-Refundable Rate Selection
In point 8.1.4 of our General Conditions, it specifies our Lite Rate (or another designated non-refundable rate) does not permit refunds or changes once the booking is confirmed.
2. Cancellation Policy
As highlighted in point 22 (Cancellation Policy) of the T&C, no refunds are issued for non-refundable bookings. This is clearly indicated at the time of reservation and accepted by the customer when finalizing the booking.
3. Explicit Acknowledgment
During the reservation process (either online or in-store), the customer was informed of the non-refundable nature of this rate. Proceeding with the booking means the customer explicitly agreed to these terms.
4. Documentation
Please see attached the booking confirmation and rate details reflecting the non-refundable policy and the customer's acceptance.
In light of the above, we regret that no refund can be issued. We are available for any additional clarification.
`.trim(),

    "Retención": `Regarding the customer's concern over the preauthorized (blocked) amount on their payment card:
1. Excess/Deposit Policy
Point 9 and 9.2 of our General Conditions establish that, when no additional coverage or partial coverage is chosen, a security deposit (or excess) preauthorization ranging from €900 to €4,000 is placed on the customer's credit card according to the vehicle's group/segment.
2. Purpose of the Preauthorization
The deposit acts as a guarantee to cover potential damages, traffic penalties, refueling, or any other charges identified at the vehicle's return. Once the rental concludes and if no incident is detected, point 9.2 clarifies that the withheld or blocked amount is automatically released.
3. Release of Funds
Our records show that after the vehicle's check-in and inspection, no additional charges were identified. Therefore, we promptly initiated the release of the preauthorized amount. The timeline for the funds to appear back on the customer's account depends on their bank's processing times.
4. Customer Authorization
The customer agreed to the deposit block by signing the Rental Agreement, which includes a clear explanation in the T&C regarding the preauthorization and subsequent release process.
Please see the attached documentation, including the signed rental contract and proof of the deposit release.
`.trim()
  };
  
  // HTML versions of defender snippets
  const DEFENDER_SNIPPETS_HTML = {};
  
  // Convert all snippets to HTML
  Object.keys(DEFENDER_SNIPPETS).forEach(key => {
    DEFENDER_SNIPPETS_HTML[key] = createHTMLSnippet(key, DEFENDER_SNIPPETS[key]);
  });

  function buildDefenderMessage(selectedCauses, useHTML = true) {
    if (useHTML) {
      let htmlContent = `
      <div style="font-family:'Nunito',Verdana,sans-serif;font-size:14px;line-height:1.5;color:#333;">
        <p>Dear Partner,</p>
      `;
      
      for (let cause of selectedCauses) {
        const snippet = DEFENDER_SNIPPETS_HTML[cause] || `<p>${cause} (no snippet found)</p>`;
        htmlContent += snippet;
        if (selectedCauses.length > 1 && cause !== selectedCauses[selectedCauses.length - 1]) {
          htmlContent += '<hr style="margin:20px 0;border:none;border-top:1px solid #eee;">';
        }
      }
      
      htmlContent += `
        <p style="margin-top:20px;">Kind regards,</p>
      </div>
      `;
      
      return htmlContent;
    } else {
      // Original plain text version
      let bodyLines = [];
      for (let cause of selectedCauses) {
        const snippet = DEFENDER_SNIPPETS[cause] || (cause + " (no snippet found)");
        bodyLines.push(snippet);
      }
      const combinedBody = bodyLines.join('\n\n');
      return GREETING + '\n' + combinedBody + '\n' + FAREWELL;
    }
  }

  /***********************************************************/
  /*** 4) MULTI-SELECT POPUP (For ACEPTAR/DEFENDER)         ***/
  function showDefenderPopup() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
      overlay.style.zIndex = '9999';

      const dialog = document.createElement('div');
      dialog.style.position = 'fixed';
      dialog.style.top = '50%';
      dialog.style.left = '50%';
      dialog.style.transform = 'translate(-50%, -50%)';
      dialog.style.backgroundColor = '#fff';
      dialog.style.padding = '20px';
      dialog.style.borderRadius = '10px';
      dialog.style.boxShadow = '0 2px 10px rgba(0,0,0,0.5)';
      dialog.style.fontFamily = 'Arial, sans-serif';
      dialog.style.width = '450px';
      dialog.style.maxHeight = '80%';
      dialog.style.overflowY = 'auto';
      dialog.style.zIndex = '10000';

      const title = document.createElement('h2');
      title.textContent = 'Select cause(s)';
      title.style.marginTop = '0';
      dialog.appendChild(title);

      const desc = document.createElement('p');
      desc.textContent = 'First selected cause is placed in Tipología text field.';
      desc.style.fontSize = '14px';
      dialog.appendChild(desc);

      const container = document.createElement('div');
      container.style.maxHeight = '300px';
      container.style.overflow = 'auto';
      container.style.marginTop = '10px';

      DEFENDER_OPTIONS.forEach(opt => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.marginBottom = '8px';
        label.style.fontSize = '14px';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = opt;
        cb.style.marginRight = '8px';
        cb.style.transform = 'scale(1.2)';
        cb.style.cursor = 'pointer';

        label.appendChild(cb);
        label.appendChild(document.createTextNode(opt));
        container.appendChild(label);
      });

      dialog.appendChild(container);

      const btnRow = document.createElement('div');
      btnRow.style.display = 'flex';
      btnRow.style.justifyContent = 'flex-end';
      btnRow.style.marginTop = '15px';

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = 'Confirm';
      confirmBtn.style.backgroundColor = '#008CBA';
      confirmBtn.style.color = '#fff';
      confirmBtn.style.border = 'none';
      confirmBtn.style.padding = '8px 16px';
      confirmBtn.style.cursor = 'pointer';
      confirmBtn.style.marginRight = '10px';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.backgroundColor = '#ccc';
      cancelBtn.style.color = '#333';
      cancelBtn.style.border = 'none';
      cancelBtn.style.padding = '8px 16px';
      cancelBtn.style.cursor = 'pointer';

      btnRow.appendChild(confirmBtn);
      btnRow.appendChild(cancelBtn);
      dialog.appendChild(btnRow);

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      confirmBtn.addEventListener('click', () => {
        const checks = container.querySelectorAll('input[type="checkbox"]:checked');
        const arr = [];
        checks.forEach(c => arr.push(c.value));
        cleanup();
        resolve(arr);
      });
      cancelBtn.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });

      function cleanup() {
        document.body.removeChild(overlay);
      }
    });
  }

  /***********************************************************/
  /*** 5) ARCHIVOS FUNCTIONALITY (PDF/Image Merge)         ***/
  // This is a simplified version that merges files into a single PDF,
  // renames that PDF to <RefNum>.pdf, automatically downloads it, then
  // attempts to attach it to the composer.

  const PDF_MIME = 'application/pdf';
  const IMAGE_MIME_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif'];

  // Wait for pdf-lib
  async function waitForPDFLib() {
    return new Promise(resolve => {
      const check = () => {
        if (window.PDFLib && window.PDFLib.PDFDocument) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async function mergeFilesIntoPDF(filesInfo) {
    await waitForPDFLib();
    const { PDFDocument } = window.PDFLib;
    const mergedPdf = await PDFDocument.create();

    // Simple approach: add them in the order they come in
    // (You can reorder or deduplicate if needed.)
    for (let { file, arrayBuffer } of filesInfo) {
      if (file.type === PDF_MIME) {
        const pdfToMerge = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mergedPdf.copyPages(pdfToMerge, pdfToMerge.getPageIndices());
        copiedPages.forEach(page => mergedPdf.addPage(page));
      } else if (IMAGE_MIME_TYPES.includes(file.type)) {
        // embed image in a new page
        let embeddedImage;
        const imgExt = file.type.split('/')[1].toLowerCase();
        if (imgExt === 'png') {
          embeddedImage = await mergedPdf.embedPng(arrayBuffer);
        } else {
          embeddedImage = await mergedPdf.embedJpg(arrayBuffer);
        }
        const { width, height } = embeddedImage.scale(1);
        const page = mergedPdf.addPage([width, height]);
        page.drawImage(embeddedImage, { x: 0, y: 0, width, height });
      }
    }

    return mergedPdf.save();
  }

  // Attempt to attach a File to the composer by simulating a "drop" event on the .ck-content
  function attachFileToComposer(file) {
    // Find the CKEditor composer
    const composer = document.querySelector('.ck.ck-content[contenteditable="true"]');
    if (!composer) {
      console.warn("No CKEditor composer found to attach file.");
      return;
    }

    // Create a DataTransfer with the file
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    // Construct a DragEvent with dataTransfer
    const dropEvent = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer
    });

    // Dispatch it on the composer
    console.log("Simulating drop event with file:", file.name);
    composer.dispatchEvent(dropEvent);
  }

  // The main modal for ARCHIVOS button
  function createArchivosModal(refNum) {
    // We'll rename the final PDF to "<refNum>.pdf"
    // so pass `refNum` in, or fallback if not found
    const style = document.createElement('style');
    style.textContent = `
      #archivosModalOverlay {
        position: fixed; top: 0; left:0; width: 100%; height: 100%;
        background-color: rgba(0,0,0,0.5);
        display: flex; justify-content: center; align-items: center;
        z-index: 999999;
      }
      #archivosModal {
        background: #fff; padding: 20px; border-radius: 5px;
        width: 800px; max-width: 90%; max-height: 90vh; 
        box-shadow: 0 0 10px rgba(0,0,0,0.5);
        position: relative; overflow-y: auto;
      }
      #archivosDragArea {
        border: 2px dashed #ccc; padding: 20px; text-align: center;
        margin-bottom: 15px;
      }
      #archivosFiles {
        display: block; margin-top: 10px;
      }
      #archivosClose {
        position: absolute; top: 5px; right: 8px; border: none;
        background: transparent; font-size: 16px; cursor: pointer;
      }
      #archivosSubmit {
        background: #008CBA; color: #fff; padding: 8px 15px;
        border: none; cursor: pointer; margin-right: 10px;
      }
      #archivosPreviewContainer {
        margin: 15px 0; max-height: 400px; overflow-y: auto;
        display: grid; grid-gap: 10px;
      }
      .archivos-preview-item {
        display: flex; align-items: center; padding: 10px;
        border: 1px solid #ddd; border-radius: 5px; position: relative;
        background: #f9f9f9; cursor: move;
      }
      .archivos-preview-item.dragging {
        opacity: 0.5;
      }
      .archivos-preview-thumbnail {
        width: 80px; height: 80px; margin-right: 15px;
        object-fit: contain; background: #fff;
        border: 1px solid #eee;
        cursor: pointer;
      }
      .archivos-preview-details {
        flex: 1;
      }
      .archivos-preview-filename {
        font-weight: bold; margin-bottom: 5px;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        max-width: 300px;
      }
      .archivos-preview-move {
        display: flex; margin-left: 10px;
      }
      .archivos-move-btn {
        background: #eee; border: none; border-radius: 3px;
        margin: 0 3px; cursor: pointer; font-size: 18px;
        width: 30px; height: 30px; display: flex;
        align-items: center; justify-content: center;
      }
      .archivos-remove-btn {
        background: #f44336; color: white;
        border: none; border-radius: 50%; width: 22px; height: 22px;
        position: absolute; top: 5px; right: 5px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 14px;
      }
      .archivos-empty {
        text-align: center; padding: 20px; color: #666;
        font-style: italic;
      }
      .archivos-preview-btn {
        background: #3855e5; color: white;
        border: none; border-radius: 3px; 
        padding: 3px 8px; margin-top: 5px;
        cursor: pointer; font-size: 12px;
      }
      #largePdfPreview {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.85); z-index: 1000000;
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
      }
      #largePdfPreviewContent {
        max-width: 90%; max-height: 80%;
        box-shadow: 0 0 20px rgba(0,0,0,0.3);
      }
      #largePdfPreviewClose {
        position: absolute; top: 20px; right: 20px;
        background: rgba(255,255,255,0.2); color: white;
        border: none; border-radius: 50%; width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; font-size: 24px;
      }
      #largePdfPreviewName {
        color: white; margin-bottom: 15px; font-size: 16px;
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'archivosModalOverlay';

    const modal = document.createElement('div');
    modal.id = 'archivosModal';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'archivosClose';
    closeBtn.textContent = '✕';

    const dragArea = document.createElement('div');
    dragArea.id = 'archivosDragArea';
    dragArea.textContent = 'Drag & drop files here or click below to select';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.id = 'archivosFiles';
    fileInput.accept = '.pdf,image/*';

    const previewContainer = document.createElement('div');
    previewContainer.id = 'archivosPreviewContainer';
    
    // Show empty message initially
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'archivos-empty';
    emptyMsg.textContent = 'No files added yet. Add files to see preview.';
    previewContainer.appendChild(emptyMsg);

    const submitBtn = document.createElement('button');
    submitBtn.id = 'archivosSubmit';
    submitBtn.textContent = 'Merge & Download PDF';

    modal.appendChild(closeBtn);
    modal.appendChild(dragArea);
    modal.appendChild(fileInput);
    modal.appendChild(previewContainer);
    modal.appendChild(submitBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Large preview container (hidden initially)
    const createLargePreview = () => {
      const largePreview = document.createElement('div');
      largePreview.id = 'largePdfPreview';
      largePreview.style.display = 'none';
      
      const previewName = document.createElement('div');
      previewName.id = 'largePdfPreviewName';
      
      const previewContent = document.createElement('img');
      previewContent.id = 'largePdfPreviewContent';
      
      const previewClose = document.createElement('button');
      previewClose.id = 'largePdfPreviewClose';
      previewClose.textContent = '✕';
      previewClose.addEventListener('click', () => {
        largePreview.style.display = 'none';
      });
      
      largePreview.appendChild(previewName);
      largePreview.appendChild(previewContent);
      largePreview.appendChild(previewClose);
      document.body.appendChild(largePreview);
      
      // Close when clicking background
      largePreview.addEventListener('click', (e) => {
        if (e.target === largePreview) {
          largePreview.style.display = 'none';
        }
      });
      
      return {
        show: (title, contentUrl, type) => {
          previewName.textContent = title;
          
          if (type === PDF_MIME) {
            // For PDFs, embed PDF viewer
            const iframe = document.createElement('iframe');
            iframe.src = contentUrl;
            iframe.style.width = '90vw';
            iframe.style.height = '80vh';
            iframe.style.border = 'none';
            iframe.style.backgroundColor = 'white';
            
            if (previewContent.tagName === 'IFRAME') {
              largePreview.replaceChild(iframe, previewContent);
            } else {
              largePreview.replaceChild(iframe, previewContent);
            }
            previewContent = iframe;
          } else {
            // For images, use img
            const img = document.createElement('img');
            img.id = 'largePdfPreviewContent';
            img.src = contentUrl;
            img.style.maxWidth = '90%';
            img.style.maxHeight = '80%';
            
            if (previewContent.tagName === 'IMG') {
              largePreview.replaceChild(img, previewContent);
            } else {
              largePreview.replaceChild(img, previewContent);
            }
            previewContent = img;
          }
          
          largePreview.style.display = 'flex';
        },
        hide: () => {
          largePreview.style.display = 'none';
        }
      };
    };
    
    const largePreview = createLargePreview();

    // We'll store selected files
    let selectedFiles = [];
    let dragSource = null;

    function updatePreview() {
      // Clear previous previews
      previewContainer.innerHTML = '';
      
      if (selectedFiles.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'archivos-empty';
        emptyMsg.textContent = 'No files added yet. Add files to see preview.';
        previewContainer.appendChild(emptyMsg);
        return;
      }
      
      // Create preview items for each file
      selectedFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'archivos-preview-item';
        item.setAttribute('data-index', index);
        
        // Thumbnail
        const thumb = document.createElement('img');
        thumb.className = 'archivos-preview-thumbnail';
        
        let objectUrl = null;
        
        if (file.type === PDF_MIME) {
          // PDF placeholder
          thumb.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MTIgNTEyIj48cGF0aCBmaWxsPSIjZTJlNWU3IiBkPSJNMTI4IDBjLTE3LjYgMC0zMiAxNC40LTMyIDMydjQ0OGMwIDE3LjYgMTQuNCAzMiAzMiAzMmgyNTZjMTcuNiAwIDMyLTE0LjQgMzItMzJWMTI4TDMwNCAwSDEyOHoiLz48cGF0aCBmaWxsPSIjYjVjM2QxIiBkPSJNMzg0IDEyOGgtODBjLTE3LjYgMC0zMi0xNC40LTMyLTMyVjBsODAgNzJoMzJ2NTZaIi8+PHBhdGggZmlsbD0iI2Y0NDMzNiIgZD0iTTM4NCAyNTZIMTI4Yy04LjggMC0xNi03LjItMTYtMTZ2LTMyYzAtOC44IDcuMi0xNiAxNi0xNmgyNTZjOC44IDAgMTYgNy4yIDE2IDE2djMyYzAgOC44LTcuMiAxNi0xNiAxNnptMCA2NEgxMjhjLTguOCAwLTE2LTcuMi0xNi0xNnYtMzJjMC04LjggNy4yLTE2IDE2LTE2aDI1NmM4LjggMCAxNiA3LjIgMTYgMTZ2MzJjMCA4LjgtNy4yIDE2LTE2IDE2em0wIDY0SDEyOGMtOC44IDAtMTYtNy4yLTE2LTE2di0zMmMwLTguOCA3LjItMTYgMTYtMTZoMjU2YzguOCAwIDE2IDcuMiAxNiAxNnYzMmMwIDguOC03LjIgMTYtMTYgMTZ6Ii8+PC9zdmc+';
          // Generate object URL for PDF
          objectUrl = URL.createObjectURL(file);
        } else if (IMAGE_MIME_TYPES.includes(file.type)) {
          // Image preview
          objectUrl = URL.createObjectURL(file);
          thumb.src = objectUrl;
        }
        
        // Add click handler for larger preview
        thumb.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent drag start
          // Show large preview
          largePreview.show(file.name, objectUrl, file.type);
        });
        
        // Details
        const details = document.createElement('div');
        details.className = 'archivos-preview-details';
        
        const filename = document.createElement('div');
        filename.className = 'archivos-preview-filename';
        filename.textContent = file.name;
        
        const filesize = document.createElement('div');
        filesize.textContent = formatFileSize(file.size);
        
        // Preview button
        const previewBtn = document.createElement('button');
        previewBtn.className = 'archivos-preview-btn';
        previewBtn.textContent = 'Preview';
        previewBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent drag start
          // Show large preview
          largePreview.show(file.name, objectUrl, file.type);
        });
        
        details.appendChild(filename);
        details.appendChild(filesize);
        details.appendChild(previewBtn);
        
        // Move buttons
        const moveControls = document.createElement('div');
        moveControls.className = 'archivos-preview-move';
        
        // Up button
        const upBtn = document.createElement('button');
        upBtn.className = 'archivos-move-btn';
        upBtn.innerHTML = '&uarr;';
        upBtn.disabled = index === 0;
        upBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          moveFile(index, 'up');
        });
        
        // Down button
        const downBtn = document.createElement('button');
        downBtn.className = 'archivos-move-btn';
        downBtn.innerHTML = '&darr;';
        downBtn.disabled = index === selectedFiles.length - 1;
        downBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          moveFile(index, 'down');
        });
        
        moveControls.appendChild(upBtn);
        moveControls.appendChild(downBtn);
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.className = 'archivos-remove-btn';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove file';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFile(index);
        });
        
        // Add drag-drop reordering
        item.draggable = true;
        item.addEventListener('dragstart', (e) => {
          dragSource = index;
          item.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', index);
        });
        
        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        });
        
        item.addEventListener('dragenter', (e) => {
          e.preventDefault();
          item.style.borderColor = '#3855e5';
        });
        
        item.addEventListener('dragleave', () => {
          item.style.borderColor = '#ddd';
        });
        
        item.addEventListener('drop', (e) => {
          e.preventDefault();
          const draggedIdx = dragSource;
          const targetIdx = index;
          
          if (draggedIdx !== targetIdx) {
            // Reorder files
            const temp = selectedFiles[draggedIdx];
            
            // Remove from original position
            selectedFiles.splice(draggedIdx, 1);
            
            // Insert at new position
            selectedFiles.splice(targetIdx, 0, temp);
            
            // Update UI
            updatePreview();
          }
          
          item.style.borderColor = '#ddd';
        });
        
        item.addEventListener('dragend', () => {
          item.classList.remove('dragging');
        });
        
        // Append all elements
        item.appendChild(thumb);
        item.appendChild(details);
        item.appendChild(moveControls);
        item.appendChild(removeBtn);
        previewContainer.appendChild(item);
      });
    }
    
    function formatFileSize(size) {
      if (size < 1024) return size + ' bytes';
      else if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
      else return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }
    
    function moveFile(index, direction) {
      if (direction === 'up' && index > 0) {
        // Swap with previous item
        const temp = selectedFiles[index];
        selectedFiles[index] = selectedFiles[index - 1];
        selectedFiles[index - 1] = temp;
      } else if (direction === 'down' && index < selectedFiles.length - 1) {
        // Swap with next item
        const temp = selectedFiles[index];
        selectedFiles[index] = selectedFiles[index + 1];
        selectedFiles[index + 1] = temp;
      }
      updatePreview();
    }
    
    function removeFile(index) {
      selectedFiles.splice(index, 1);
      updatePreview();
    }

    function handleNewFiles(fileList) {
      let added = 0;
      for (let file of fileList) {
        // only add if PDF or recognized image
        if (file.type === PDF_MIME || IMAGE_MIME_TYPES.includes(file.type)) {
          // Check for duplicates by name
          const isDuplicate = selectedFiles.some(f => f.name === file.name && f.size === file.size);
          if (!isDuplicate) {
            selectedFiles.push(file);
            added++;
          }
        } else {
          alert(`Skipping file "${file.name}" – not a PDF or recognized image type.`);
        }
      }
      
      if (added > 0) {
        updatePreview();
      }
      
      return added;
    }

    // DRAG events
    ['dragenter', 'dragover'].forEach(evtName => {
      dragArea.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragArea.style.borderColor = '#008CBA';
      }, false);
    });
    ['dragleave', 'drop'].forEach(evtName => {
      dragArea.addEventListener(evtName, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragArea.style.borderColor = '#ccc';
      }, false);
    });
    dragArea.addEventListener('drop', (e) => {
      const added = handleNewFiles(e.dataTransfer.files);
      if (added > 0) {
        // Scroll to show previews
        previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // FILE input
    fileInput.addEventListener('change', (e) => {
      const added = handleNewFiles(e.target.files);
      if (added > 0) {
        // Scroll to show previews
        previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // CLOSE
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });

    // SUBMIT => Merge & Download
    submitBtn.addEventListener('click', async () => {
      if (selectedFiles.length === 0) {
        alert('No files selected!');
        return;
      }
      
      submitBtn.disabled = true;
      submitBtn.textContent = 'Processing...';
      
      try {
        // Convert each File => arrayBuffer
        const filesInfo = [];
        for (let f of selectedFiles) {
          let ab = await f.arrayBuffer();
          filesInfo.push({ file: f, arrayBuffer: ab });
        }
        
        const mergedPdfBytes = await mergeFilesIntoPDF(filesInfo);

        // We'll rename the final PDF as "<RefNum>.pdf" or fallback to "merged_files.pdf"
        const finalPdfName = (refNum ? refNum : 'merged_files') + '.pdf';
        // 1) Create a Blob
        const blob = new Blob([mergedPdfBytes], { type: PDF_MIME });
        // 2) Download it
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = finalPdfName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        // 3) Also attach it to composer
        // We create a new File from the blob, with the same name
        const pdfFile = new File([blob], finalPdfName, { type: PDF_MIME });
        attachFileToComposer(pdfFile);

        // 4) Close modal
        document.body.removeChild(overlay);
      } catch (err) {
        console.error('Error merging files:', err);
        alert('Error merging files. Check console for details.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Merge & Download PDF';
      }
    });
  }

  // Create ARCHIVOS button & attach logic
  function addArchivosButton(footer, getRefNumFn) {
    const archBtn = document.createElement('button');
    archBtn.id = 'btnUpArchivos';
    archBtn.textContent = 'ARCHIVOS';
    archBtn.style.backgroundColor = '#9C27B0';
    archBtn.style.color = '#fff';
    archBtn.style.border = 'none';
    archBtn.style.padding = '6px 12px';
    archBtn.style.marginRight = '5px';
    archBtn.style.cursor = 'pointer';
    archBtn.style.display = 'none'; // hidden until "UP" is clicked

    footer.prepend(archBtn);

    archBtn.addEventListener('click', () => {
      // Get the current reference number so we can name the final PDF
      const refNum = getRefNumFn();
      createArchivosModal(refNum);
    });

    return archBtn;
  }

  /**********************************************************/
  /*** 6) INJECT THE "UP" BUTTON & MAIN LOGIC             ***/
  const FOOTER_CONTAINER_SELECTOR = '.sc-177ytgv-1.WxSHa';

  function injectUpButtons() {
    if (document.getElementById('btnUpMain')) return;

    const footer = document.querySelector(FOOTER_CONTAINER_SELECTOR);
    if (!footer) return;

    // main "UP" button
    const upBtn = document.createElement('button');
    upBtn.id = 'btnUpMain';
    upBtn.textContent = 'UP';
    upBtn.style.marginRight = '10px';
    upBtn.style.backgroundColor = '#008CBA';
    upBtn.style.color = '#fff';
    upBtn.style.border = 'none';
    upBtn.style.padding = '6px 12px';
    upBtn.style.cursor = 'pointer';

    // ACEPTAR
    const aceptarBtn = document.createElement('button');
    aceptarBtn.id = 'btnUpAceptar';
    aceptarBtn.textContent = 'ACEPTAR';
    aceptarBtn.style.backgroundColor = '#4CAF50';
    aceptarBtn.style.color = '#fff';
    aceptarBtn.style.border = 'none';
    aceptarBtn.style.padding = '6px 12px';
    aceptarBtn.style.marginRight = '5px';
    aceptarBtn.style.cursor = 'pointer';
    aceptarBtn.style.display = 'none';

    // DEFENDER
    const defenderBtn = document.createElement('button');
    defenderBtn.id = 'btnUpDefender';
    defenderBtn.textContent = 'DEFENDER';
    defenderBtn.style.backgroundColor = '#f44336';
    defenderBtn.style.color = '#fff';
    defenderBtn.style.border = 'none';
    defenderBtn.style.padding = '6px 12px';
    defenderBtn.style.marginRight = '5px';
    defenderBtn.style.cursor = 'pointer';
    defenderBtn.style.display = 'none';

    // ARCHIVOS (new)
    const archBtn = addArchivosButton(footer, () => {
      // read the subject again, extract ref
      const subj = getTicketSubject();
      return extractRefNumber(subj);
    });

    footer.prepend(upBtn, aceptarBtn, defenderBtn);

    // Toggle sub-buttons
    upBtn.addEventListener('click', () => {
      const hidden = (aceptarBtn.style.display === 'none');
      aceptarBtn.style.display = hidden ? 'inline-block' : 'none';
      defenderBtn.style.display = hidden ? 'inline-block' : 'none';
      archBtn.style.display = hidden ? 'inline-block' : 'none';
    });

    // ACEPTAR => short text
    aceptarBtn.addEventListener('click', async () => {
      const subj = getTicketSubject();
      const refNum = extractRefNumber(subj);
      if (!refNum) {
        alert('No valid reference found in subject!');
        return;
      }
      setTextFieldByLabel(REFERENCIA_LABEL, refNum);

      const chosen = await showDefenderPopup();
      if (!chosen || chosen.length === 0) {
        setReplyText(ACEPTAR_TEXT_HTML, true);
        alert('No causes selected. Short accept text inserted.');
        return;
      }
      setTextFieldByLabel(TIPOLOGIA_LABEL, chosen[0]);
      setReplyText(ACEPTAR_TEXT_HTML, true);
      alert(`Ref #${refNum}. Tipología='${chosen[0]}'. Inserted short accept text.`);
    });

    // DEFENDER => multi-cause text
    defenderBtn.addEventListener('click', async () => {
      const subj = getTicketSubject();
      const refNum = extractRefNumber(subj);
      if (!refNum) {
        alert('No valid reference found in subject!');
        return;
      }
      setTextFieldByLabel(REFERENCIA_LABEL, refNum);

      const chosen = await showDefenderPopup();
      if (!chosen || chosen.length === 0) {
        alert('No causes selected => do nothing.');
        return;
      }
      setTextFieldByLabel(TIPOLOGIA_LABEL, chosen[0]);
      const finalMsg = buildDefenderMessage(chosen, true);
      setReplyText(finalMsg, true);
      alert(`Ref #${refNum}. Tipología='${chosen[0]}'. Inserted multi-cause text (single greeting/farewell).`);
    });
  }

  const interval = setInterval(() => {
    injectUpButtons();
    if (document.getElementById('btnUpMain')) {
      console.log('UP, ACEPTAR, DEFENDER, ARCHIVOS => loaded with rename & auto-attach.');
      clearInterval(interval);
    }
  }, 1500);

})();
