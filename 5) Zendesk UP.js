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
  <div style="font-family:'Nunito',Verdana,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:800px;">
    <p style="font-size:15px;margin-bottom:15px;">Dear Partner,</p>
    <p style="margin:15px 0;">Thanks for your email.</p>
    <p style="font-weight:bold;color:#4CAF50;margin:20px 0;font-size:15px;">We accept the proposed chargeback.</p>
    <p style="margin-top:25px;font-size:15px;">Kind regards,</p>
  </div>
  `;

  // New HTML styled DEFENDER text
  const DEFENDER_TEXT_HTML = `
  <div style="font-family:'Nunito',Verdana,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:800px;">
    <p style="font-size:15px;margin-bottom:15px;">Dear Partner,</p>
    <p style="margin:15px 0;">Thanks for your email.</p>
    <p style="font-weight:bold;color:#f44336;margin:20px 0;font-size:15px;">We do not accept the proposed chargeback.</p>
    <p style="margin:15px 0;">Please find attached the documentation with our reasons for defending this case.</p>
    <p style="margin-top:25px;font-size:15px;">Kind regards,</p>
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
    formattedContent = formattedContent.replace(/(\d+\.\s*)([^\n]+)/g, 
      '<h3 style="margin:25px 0 15px;color:#3855e5;font-size:16px;font-weight:bold;border-bottom:1px solid #eee;padding-bottom:8px;">$1$2</h3>');
    
    // Replace arrow points with list items
    formattedContent = formattedContent.replace(/(->\s+)([^\n]+)/g, 
      '<li style="margin-bottom:8px;position:relative;">$2</li>');
    
    // Wrap lists in <ul> tags with better styling
    if (formattedContent.includes('<li')) {
      formattedContent = formattedContent.replace(/(<li.*?<\/li>)/gs, 
        '<ul style="margin:15px 0 20px 10px;padding-left:25px;list-style-type:circle;">$1</ul>');
    }
    
    // Convert regular paragraphs with better spacing
    // Look for paragraphs that aren't already wrapped in HTML tags
    formattedContent = formattedContent.replace(/^(?!<h3|<ul|<\/ul>|<li|<\/li>|<p|<\/p>)(.+)$/gm, 
      '<p style="margin:12px 0;line-height:1.6;">$1</p>');
    
    // Make sure paragraphs have proper spacing in between
    // Replace single line breaks with proper paragraphs
    formattedContent = formattedContent.replace(/<\/p>\s*<p/g, '</p>\n\n<p');
    
    // Add extra spacing before the final clarification paragraph
    formattedContent = formattedContent.replace(/(evidence[\s\S]*?measures\.)<\/p>\s*<p>(We are available|We remain at your)/g, 
      '$1</p>\n\n<p style="margin-top:25px;">$2');
    
    // Add extra space before any farewell/clarification paragraphs
    formattedContent = formattedContent.replace(/<p>(We (are available|remain|stand|trust|apologize|regret))/g, 
      '<p style="margin-top:25px;">$1');
    
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
      <div style="font-family:'Nunito',Verdana,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:800px;">
        <p style="font-size:15px;margin-bottom:20px;">Dear Partner,</p>
      `;
      
      for (let i = 0; i < selectedCauses.length; i++) {
        const cause = selectedCauses[i];
        const snippet = DEFENDER_SNIPPETS_HTML[cause] || `<p>${cause} (no snippet found)</p>`;
        
        // Don't add cause title even if there are multiple causes
        // We only use cause internally for reference
        
        htmlContent += snippet;
        
        // Add separator between causes except after the last one
        if (i < selectedCauses.length - 1) {
          htmlContent += '<hr style="margin:30px 0;border:none;border-top:1px solid #eee;height:1px;">';
        }
      }
      
      htmlContent += `
        <p style="margin-top:35px;font-size:15px;padding-top:10px;">Kind regards,</p>
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
      return GREETING + '\n\n' + combinedBody + '\n\n\n' + FAREWELL;
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
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds total (50 * 100ms)
      
      const check = () => {
        attempts++;
        console.log(`Checking for PDFLib (attempt ${attempts}/${maxAttempts})...`);
        
        if (window.PDFLib && window.PDFLib.PDFDocument) {
          console.log('PDFLib found!');
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error('PDFLib not loaded after multiple attempts. Check if the library is properly included.'));
        } else {
          setTimeout(check, 100);
        }
      };
      
      check();
    });
  }

  async function mergeFilesIntoPDF(filesInfo) {
    try {
      console.log('Waiting for PDFLib to load...');
      await waitForPDFLib();
      console.log('PDFLib loaded successfully');
      
      const { PDFDocument } = window.PDFLib;
      console.log('Creating new PDF document');
      const mergedPdf = await PDFDocument.create();

      // Simple approach: add them in the order they come in
      for (let i = 0; i < filesInfo.length; i++) {
        const { file, arrayBuffer } = filesInfo[i];
        console.log(`Processing file ${i+1}/${filesInfo.length}: ${file.name} (${file.type})`);
        
        if (file.type === PDF_MIME) {
          console.log('Loading PDF document...');
          try {
            const pdfToMerge = await PDFDocument.load(arrayBuffer);
            console.log('PDF loaded, copying pages...');
            const pageIndices = pdfToMerge.getPageIndices();
            console.log(`PDF has ${pageIndices.length} pages`);
            
            const copiedPages = await mergedPdf.copyPages(pdfToMerge, pageIndices);
            console.log('Pages copied, adding to document...');
            
            copiedPages.forEach(page => mergedPdf.addPage(page));
            console.log('Pages added successfully');
          } catch (pdfErr) {
            console.error('Error processing PDF:', pdfErr);
            throw new Error(`Error processing PDF file ${file.name}: ${pdfErr.message}`);
          }
        } else if (IMAGE_MIME_TYPES.includes(file.type)) {
          console.log('Processing image...');
          try {
            // embed image in a new page
            let embeddedImage;
            const imgExt = file.type.split('/')[1].toLowerCase();
            
            if (imgExt === 'png') {
              console.log('Embedding PNG image...');
              embeddedImage = await mergedPdf.embedPng(arrayBuffer);
            } else {
              console.log('Embedding JPG image...');
              embeddedImage = await mergedPdf.embedJpg(arrayBuffer);
            }
            
            console.log('Image embedded, creating page...');
            const { width, height } = embeddedImage.scale(1);
            const page = mergedPdf.addPage([width, height]);
            
            console.log('Drawing image on page...');
            page.drawImage(embeddedImage, { x: 0, y: 0, width, height });
            console.log('Image added successfully');
          } catch (imgErr) {
            console.error('Error processing image:', imgErr);
            throw new Error(`Error processing image file ${file.name}: ${imgErr.message}`);
          }
        }
      }

      console.log('All files processed, saving PDF...');
      return mergedPdf.save();
    } catch (err) {
      console.error('Error in mergeFilesIntoPDF:', err);
      throw err;
    }
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
        console.log('Starting PDF merge process for', selectedFiles.length, 'files');
        // Convert each File => arrayBuffer
        const filesInfo = [];
        for (let f of selectedFiles) {
          console.log('Processing file:', f.name, f.type);
          try {
            let ab = await f.arrayBuffer();
            filesInfo.push({ file: f, arrayBuffer: ab });
            console.log('Successfully processed file:', f.name);
          } catch (fileErr) {
            console.error('Error processing file:', f.name, fileErr);
            throw new Error(`Error processing file: ${f.name}: ${fileErr.message}`);
          }
        }
        
        console.log('All files processed, starting merge operation');
        const mergedPdfBytes = await mergeFilesIntoPDF(filesInfo);
        console.log('PDF merge completed, size:', mergedPdfBytes.length);

        // We'll rename the final PDF as "<RefNum>.pdf" or fallback to "merged_files.pdf"
        const finalPdfName = (refNum ? refNum : 'merged_files') + '.pdf';
        console.log('Creating final PDF with name:', finalPdfName);
        
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
        console.log('PDF download initiated');

        // 3) Also attach it to composer
        // We create a new File from the blob, with the same name
        const pdfFile = new File([blob], finalPdfName, { type: PDF_MIME });
        attachFileToComposer(pdfFile);
        console.log('Attached PDF to composer');

        // 4) Close modal
        document.body.removeChild(overlay);
      } catch (err) {
        console.error('Error merging files:', err);
        alert('Error merging files: ' + err.message);
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

    // DEFENDER (merged with ARCHIVOS functionality)
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

    // Add buttons to the footer
    footer.prepend(upBtn, aceptarBtn, defenderBtn);

    // Toggle sub-buttons
    upBtn.addEventListener('click', () => {
      const hidden = (aceptarBtn.style.display === 'none');
      aceptarBtn.style.display = hidden ? 'inline-block' : 'none';
      defenderBtn.style.display = hidden ? 'inline-block' : 'none';
    });

    // ACEPTAR => short text
    aceptarBtn.addEventListener('click', async () => {
      const subj = getTicketSubject();
      const refNum = extractRefNumber(subj);
      if (!refNum) {
        // Keep only critical alert for missing reference
        alert('No valid reference found in subject!');
        return;
      }
      setTextFieldByLabel(REFERENCIA_LABEL, refNum);

      // Skip reason selection for ACEPTAR - it's always the same
      setReplyText(ACEPTAR_TEXT_HTML, true);
      // No alert - fully automatic
    });

    // DEFENDER => multi-cause text + document upload and merge in one workflow
    defenderBtn.addEventListener('click', async () => {
      const subj = getTicketSubject();
      const refNum = extractRefNumber(subj);
      if (!refNum) {
        // Keep only critical alert for missing reference
        alert('No valid reference found in subject!');
        return;
      }
      setTextFieldByLabel(REFERENCIA_LABEL, refNum);

      // Step 1: Select reasons
      const chosen = await showDefenderPopup();
      if (!chosen || chosen.length === 0) {
        // User canceled or didn't select anything
        return;
      }
      setTextFieldByLabel(TIPOLOGIA_LABEL, chosen[0]);
      
      // Step 2: Generate cover page and open document selection modal
      try {
        // Use the standard Defender message in the Zendesk text field
        setReplyText(DEFENDER_TEXT_HTML, true);
        
        // Create a defender cover page PDF
        const coverPageBytes = await generateDefenderCoverPage(chosen);
        
        // Open unified file selection modal with cover page already included
        createDefenderModal(refNum, coverPageBytes, chosen);
      } catch (err) {
        console.error('Error creating defender PDF:', err);
        alert('Error creating defender PDF: ' + err.message);
      }
    });
  }

  const interval = setInterval(() => {
    injectUpButtons();
    if (document.getElementById('btnUpMain')) {
      console.log('UP, ACEPTAR, DEFENDER => loaded with unified defender workflow');
      clearInterval(interval);
    }
  }, 1500);

  // New function to generate a PDF cover page with defender reasons
  async function generateDefenderCoverPage(selectedCauses) {
    await waitForPDFLib();
    const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
    
    // Create a new PDF document
    const pdfDoc = await PDFDocument.create();
    
    // Add a blank page (A4 size)
    const page = pdfDoc.addPage([595, 842]);
    
    // Get fonts
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    
    // OK Mobility colors
    const okBlue = rgb(56/255, 85/255, 229/255); // #3855e5
    
    // Define margins
    const margin = 50;
    const width = page.getWidth() - 2 * margin;
    
    // Current y-position (start from top)
    let y = page.getHeight() - margin;

    // Add title
    page.drawText("OK MOBILITY GROUP", {
      x: margin,
      y: y,
      size: 24,
      font: helveticaBold,
      color: okBlue
    });
    
    y -= 15;
    
    // Add horizontal line
    page.drawLine({
      start: { x: margin, y },
      end: { x: page.getWidth() - margin, y },
      thickness: 2,
      color: okBlue
    });
    
    y -= 40;
    
    // Add document title
    page.drawText("CHARGEBACK DEFENSE DOCUMENTATION", {
      x: margin,
      y,
      size: 18,
      font: helveticaBold
    });
    
    y -= 40;
    
    // Add current date
    const today = new Date();
    const dateStr = today.toLocaleDateString('en-GB', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
    
    page.drawText(`Date: ${dateStr}`, {
      x: margin,
      y,
      size: 12,
      font: helvetica
    });
    
    y -= 40;
    
    // Draw reasons section title
    page.drawText("REASONS FOR REJECTING THE CHARGEBACK:", {
      x: margin,
      y,
      size: 14,
      font: helveticaBold,
      color: okBlue
    });
    
    y -= 30;
    
    // Add each selected cause
    for (let cause of selectedCauses) {
      // Calculate if text will fit on current page
      if (y < margin + 100) {
        // Add a new page if we're running out of space
        page = pdfDoc.addPage([595, 842]);
        y = page.getHeight() - margin;
      }
      
      // Draw bullet point
      page.drawText("•", {
        x: margin,
        y,
        size: 12,
        font: helvetica
      });
      
      // Draw cause text
      page.drawText(cause, {
        x: margin + 15,
        y,
        size: 12,
        font: helveticaBold
      });
      
      y -= 20;
      
      // Add explanation text based on the cause (reuse snippets)
      const snippet = DEFENDER_SNIPPETS[cause] || "";
      // Extract first paragraph/sentence as summary
      const summary = snippet.split('\n')[0]?.substring(0, 120) + "...";
      
      if (summary && summary.length > 3) {
        // Word wrap the summary to fit the page width
        const words = summary.split(' ');
        let line = '';
        
        for (let word of words) {
          const testLine = line + word + ' ';
          const textWidth = helvetica.widthOfTextAtSize(testLine, 10);
          
          if (textWidth > width - 15) {
            // Draw the current line
            page.drawText(line, {
              x: margin + 15,
              y,
              size: 10,
              font: helvetica
            });
            y -= 15;
            line = word + ' ';
          } else {
            line = testLine;
          }
        }
        
        // Draw the remaining text
        if (line.trim()) {
          page.drawText(line, {
            x: margin + 15,
            y,
            size: 10,
            font: helvetica
          });
          y -= 20;
        }
      }
      
      // Add extra spacing between causes
      y -= 10;
    }
    
    // Add footer
    y = margin + 40;
    
    // Add horizontal line
    page.drawLine({
      start: { x: margin, y },
      end: { x: page.getWidth() - margin, y },
      thickness: 1,
      color: okBlue
    });
    
    y -= 25;
    
    // Add footer text
    page.drawText("OK Mobility Group", {
      x: margin,
      y,
      size: 10,
      font: helveticaBold
    });
    
    y -= 15;
    
    page.drawText("www.okmobility.com", {
      x: margin,
      y,
      size: 10,
      font: helvetica,
      color: okBlue
    });
    
    // Serialize the PDFDocument to bytes
    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
  }

  // Function to merge defender cover page with other files
  async function mergeDefenderFiles(coverPageBytes, filesInfo) {
    await waitForPDFLib();
    const { PDFDocument } = window.PDFLib;
    
    // Create the main PDF document starting with the cover page
    const mainPdf = await PDFDocument.load(coverPageBytes);
    
    // Add each file in the order they come in
    for (let { file, arrayBuffer } of filesInfo) {
      if (file.type === PDF_MIME) {
        const pdfToMerge = await PDFDocument.load(arrayBuffer);
        const copiedPages = await mainPdf.copyPages(pdfToMerge, pdfToMerge.getPageIndices());
        copiedPages.forEach(page => mainPdf.addPage(page));
      } else if (IMAGE_MIME_TYPES.includes(file.type)) {
        // embed image in a new page (same as in mergeFilesIntoPDF)
        let embeddedImage;
        const imgExt = file.type.split('/')[1].toLowerCase();
        if (imgExt === 'png') {
          embeddedImage = await mainPdf.embedPng(arrayBuffer);
        } else {
          embeddedImage = await mainPdf.embedJpg(arrayBuffer);
        }
        
        // Create page with image aspect ratio
        const { width, height } = embeddedImage;
        const isLandscape = width > height;
        
        const imgPage = isLandscape 
          ? mainPdf.addPage([842, 595]) // A4 landscape
          : mainPdf.addPage([595, 842]); // A4 portrait
        
        // Scale image to fit page
        const pageWidth = imgPage.getWidth() - 40;
        const pageHeight = imgPage.getHeight() - 40;
        const scaleW = pageWidth / width;
        const scaleH = pageHeight / height;
        const scale = Math.min(scaleW, scaleH);
        
        const scaledWidth = width * scale;
        const scaledHeight = height * scale;
        
        // Center the image on the page
        const x = (imgPage.getWidth() - scaledWidth) / 2;
        const y = (imgPage.getHeight() - scaledHeight) / 2;
        
        imgPage.drawImage(embeddedImage, {
          x,
          y,
          width: scaledWidth,
          height: scaledHeight
        });
      }
    }
    
    const pdfBytes = await mainPdf.save();
    return pdfBytes;
  }

  // Function to create the defender modal with cover page already included
  function createDefenderModal(refNum, coverPageBytes, selectedCauses) {
    // Create a File object for the cover page
    const coverPageFile = new File(
      [coverPageBytes], 
      'cover_page.pdf', 
      { type: PDF_MIME }
    );
    
    // Selected files array (starting with cover page)
    const selectedFiles = [];
    
    // Add the cover page as the first file
    selectedFiles.push(coverPageFile);
    
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
    overlay.style.backdropFilter = 'blur(3px)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';

    // Create modal container
    const modal = document.createElement('div');
    modal.style.backgroundColor = '#fff';
    modal.style.borderRadius = '10px';
    modal.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
    modal.style.width = '90%';
    modal.style.maxWidth = '800px';
    modal.style.maxHeight = '90%';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.overflow = 'hidden';
    modal.style.position = 'relative';

    // Header
    const header = document.createElement('div');
    header.style.padding = '15px 20px';
    header.style.borderBottom = '1px solid #eee';
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.backgroundColor = '#f44336';
    header.style.color = 'white';

    const title = document.createElement('h2');
    title.textContent = 'Defender Documentation';
    title.style.margin = '0';
    title.style.fontSize = '18px';
    title.style.fontWeight = 'bold';
    title.style.color = 'white';

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Step 2: Add supporting documents';
    subtitle.style.fontSize = '13px';
    subtitle.style.opacity = '0.9';
    
    const titleContainer = document.createElement('div');
    titleContainer.style.display = 'flex';
    titleContainer.style.flexDirection = 'column';
    titleContainer.appendChild(title);
    titleContainer.appendChild(subtitle);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.fontSize = '24px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = 'white';
    closeBtn.style.width = '30px';
    closeBtn.style.height = '30px';
    closeBtn.style.display = 'flex';
    closeBtn.style.justifyContent = 'center';
    closeBtn.style.alignItems = 'center';
    closeBtn.style.borderRadius = '50%';
    closeBtn.style.transition = 'background-color 0.2s';
    closeBtn.style.marginLeft = 'auto';

    closeBtn.addEventListener('mouseover', () => {
      closeBtn.style.backgroundColor = 'rgba(255,255,255,0.2)';
    });
    closeBtn.addEventListener('mouseout', () => {
      closeBtn.style.backgroundColor = 'transparent';
    });

    header.appendChild(titleContainer);
    header.appendChild(closeBtn);

    // Content area
    const content = document.createElement('div');
    content.style.padding = '20px';
    content.style.overflowY = 'auto';
    content.style.flex = '1';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    content.style.gap = '20px';

    // Progress indicator
    const progressContainer = document.createElement('div');
    progressContainer.style.display = 'flex';
    progressContainer.style.justifyContent = 'center';
    progressContainer.style.marginBottom = '10px';

    const stepsContainer = document.createElement('div');
    stepsContainer.style.display = 'flex';
    stepsContainer.style.alignItems = 'center';
    stepsContainer.style.gap = '10px';

    // Step 1 (completed)
    const step1 = document.createElement('div');
    step1.style.display = 'flex';
    step1.style.alignItems = 'center';
    step1.style.gap = '8px';

    const step1Circle = document.createElement('div');
    step1Circle.style.width = '24px';
    step1Circle.style.height = '24px';
    step1Circle.style.borderRadius = '50%';
    step1Circle.style.backgroundColor = '#4CAF50';
    step1Circle.style.color = 'white';
    step1Circle.style.display = 'flex';
    step1Circle.style.justifyContent = 'center';
    step1Circle.style.alignItems = 'center';
    step1Circle.style.fontWeight = 'bold';
    step1Circle.style.fontSize = '14px';
    step1Circle.innerHTML = '✓';

    const step1Text = document.createElement('div');
    step1Text.textContent = 'Select Reasons';
    step1Text.style.fontSize = '14px';
    step1Text.style.fontWeight = 'bold';
    step1Text.style.color = '#4CAF50';

    step1.appendChild(step1Circle);
    step1.appendChild(step1Text);

    // Connector
    const connector = document.createElement('div');
    connector.style.width = '30px';
    connector.style.height = '2px';
    connector.style.backgroundColor = '#ddd';

    // Step 2 (current)
    const step2 = document.createElement('div');
    step2.style.display = 'flex';
    step2.style.alignItems = 'center';
    step2.style.gap = '8px';

    const step2Circle = document.createElement('div');
    step2Circle.style.width = '24px';
    step2Circle.style.height = '24px';
    step2Circle.style.borderRadius = '50%';
    step2Circle.style.backgroundColor = '#f44336';
    step2Circle.style.color = 'white';
    step2Circle.style.display = 'flex';
    step2Circle.style.justifyContent = 'center';
    step2Circle.style.alignItems = 'center';
    step2Circle.style.fontWeight = 'bold';
    step2Circle.style.fontSize = '14px';
    step2Circle.textContent = '2';

    const step2Text = document.createElement('div');
    step2Text.textContent = 'Add Documents';
    step2Text.style.fontSize = '14px';
    step2Text.style.fontWeight = 'bold';
    step2Text.style.color = '#333';

    step2.appendChild(step2Circle);
    step2.appendChild(step2Text);

    // Connector
    const connector2 = document.createElement('div');
    connector2.style.width = '30px';
    connector2.style.height = '2px';
    connector2.style.backgroundColor = '#ddd';

    // Step 3 (upcoming)
    const step3 = document.createElement('div');
    step3.style.display = 'flex';
    step3.style.alignItems = 'center';
    step3.style.gap = '8px';

    const step3Circle = document.createElement('div');
    step3Circle.style.width = '24px';
    step3Circle.style.height = '24px';
    step3Circle.style.borderRadius = '50%';
    step3Circle.style.backgroundColor = '#eee';
    step3Circle.style.color = '#666';
    step3Circle.style.display = 'flex';
    step3Circle.style.justifyContent = 'center';
    step3Circle.style.alignItems = 'center';
    step3Circle.style.fontWeight = 'bold';
    step3Circle.style.fontSize = '14px';
    step3Circle.textContent = '3';

    const step3Text = document.createElement('div');
    step3Text.textContent = 'Complete';
    step3Text.style.fontSize = '14px';
    step3Text.style.color = '#666';

    step3.appendChild(step3Circle);
    step3.appendChild(step3Text);

    stepsContainer.appendChild(step1);
    stepsContainer.appendChild(connector);
    stepsContainer.appendChild(step2);
    stepsContainer.appendChild(connector2);
    stepsContainer.appendChild(step3);

    progressContainer.appendChild(stepsContainer);
    content.appendChild(progressContainer);

    // Selected reasons summary
    const reasonsSummary = document.createElement('div');
    reasonsSummary.style.backgroundColor = '#f5f5f5';
    reasonsSummary.style.padding = '15px';
    reasonsSummary.style.borderRadius = '6px';
    reasonsSummary.style.fontSize = '14px';
    reasonsSummary.style.border = '1px solid #eee';
    reasonsSummary.style.marginBottom = '10px';

    const reasonsTitle = document.createElement('div');
    reasonsTitle.style.fontWeight = 'bold';
    reasonsTitle.style.marginBottom = '8px';
    reasonsTitle.style.display = 'flex';
    reasonsTitle.style.alignItems = 'center';
    reasonsTitle.style.gap = '5px';
    reasonsTitle.innerHTML = '<svg fill="#4CAF50" width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg> Selected Reasons:';

    const reasonsList = document.createElement('ul');
    reasonsList.style.margin = '0';
    reasonsList.style.paddingLeft = '25px';
    reasonsList.innerHTML = selectedCauses.map(cause => `<li style="margin-bottom:4px;">${cause}</li>`).join('');

    reasonsSummary.appendChild(reasonsTitle);
    reasonsSummary.appendChild(reasonsList);
    content.appendChild(reasonsSummary);

    // Info section explaining that cover page is already added
    const infoSection = document.createElement('div');
    infoSection.style.backgroundColor = '#e8f4fd';
    infoSection.style.padding = '15px';
    infoSection.style.borderRadius = '6px';
    infoSection.style.fontSize = '14px';
    infoSection.style.border = '1px solid #d0e8ff';

    const infoTitle = document.createElement('div');
    infoTitle.style.fontWeight = 'bold';
    infoTitle.style.fontSize = '15px';
    infoTitle.style.marginBottom = '10px';
    infoTitle.style.display = 'flex';
    infoTitle.style.alignItems = 'center';
    infoTitle.style.gap = '8px';
    infoTitle.innerHTML = '<svg fill="#2196F3" width="20" height="20" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg> Documents Workflow';

    const infoText = document.createElement('div');
    infoText.innerHTML = `
      <p style="margin-top:0;margin-bottom:8px;">1. A cover page with your selected reasons has been automatically created</p>
      <p style="margin-top:0;margin-bottom:8px;">2. Add supporting documents below to complete your defense package</p>
      <p style="margin-top:0;margin-bottom:0;">3. Click "Create Defense PDF" to generate and attach your complete document</p>
    `;

    infoSection.appendChild(infoTitle);
    infoSection.appendChild(infoText);
    content.appendChild(infoSection);

    // Previews container
    const previewContainer = document.createElement('div');
    previewContainer.style.display = 'flex';
    previewContainer.style.flexDirection = 'column';
    previewContainer.style.gap = '10px';
    
    // First preview will be the cover page (already locked)
    const coverPreview = document.createElement('div');
    coverPreview.className = 'file-preview';
    coverPreview.style.padding = '10px';
    coverPreview.style.backgroundColor = '#f0f4ff';
    coverPreview.style.borderRadius = '6px';
    coverPreview.style.display = 'flex';
    coverPreview.style.alignItems = 'center';
    coverPreview.style.border = '1px solid #d0dcff';
    
    const coverIcon = document.createElement('div');
    coverIcon.style.width = '40px';
    coverIcon.style.height = '40px';
    coverIcon.style.backgroundColor = '#3855e5';
    coverIcon.style.borderRadius = '6px';
    coverIcon.style.display = 'flex';
    coverIcon.style.justifyContent = 'center';
    coverIcon.style.alignItems = 'center';
    coverIcon.style.marginRight = '10px';
    coverIcon.style.flexShrink = '0';
    coverIcon.innerHTML = '<svg fill="#fff" width="24" height="24" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM16 18H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
    
    const coverInfo = document.createElement('div');
    coverInfo.style.flex = '1';
    coverInfo.style.minWidth = '0';
    
    const coverName = document.createElement('div');
    coverName.textContent = 'Cover Page with Reasons (Auto-Generated)';
    coverName.style.fontWeight = 'bold';
    coverName.style.whiteSpace = 'nowrap';
    coverName.style.overflow = 'hidden';
    coverName.style.textOverflow = 'ellipsis';
    
    const coverDesc = document.createElement('div');
    coverDesc.textContent = 'Always appears as the first page - Position locked';
    coverDesc.style.fontSize = '12px';
    coverDesc.style.color = '#666';
    
    coverInfo.appendChild(coverName);
    coverInfo.appendChild(coverDesc);
    
    const coverLock = document.createElement('div');
    coverLock.style.marginLeft = '10px';
    coverLock.style.flexShrink = '0';
    coverLock.innerHTML = '<svg fill="#999" width="16" height="16" viewBox="0 0 24 24"><path d="M12 2C8.14 2 5 5.14 5 9v2H4c-1.1 0-2 .9-2 2v7c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-7c0-1.1-.9-2-2-2h-1V9c0-3.86-3.14-7-7-7zm5 11h-1.5v5h-9v-5H5v-2h1V9c0-2.76 2.24-5 5-5s5 2.24 5 5v2h1v2z"/></svg>';
    
    coverPreview.appendChild(coverIcon);
    coverPreview.appendChild(coverInfo);
    coverPreview.appendChild(coverLock);
    
    previewContainer.appendChild(coverPreview);
    
    // Function to update the preview
    function updatePreview() {
      // Clear existing previews (except cover page)
      while (previewContainer.children.length > 1) {
        previewContainer.removeChild(previewContainer.lastChild);
      }
      
      // Add each file preview
      for (let i = 1; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        
        const previewDiv = document.createElement('div');
        previewDiv.className = 'file-preview';
        previewDiv.style.padding = '10px';
        previewDiv.style.backgroundColor = '#f8f8f8';
        previewDiv.style.borderRadius = '6px';
        previewDiv.style.display = 'flex';
        previewDiv.style.alignItems = 'center';
        previewDiv.style.border = '1px solid #eee';
        
        // Icon based on type
        const iconDiv = document.createElement('div');
        iconDiv.style.width = '40px';
        iconDiv.style.height = '40px';
        iconDiv.style.borderRadius = '6px';
        iconDiv.style.display = 'flex';
        iconDiv.style.justifyContent = 'center';
        iconDiv.style.alignItems = 'center';
        iconDiv.style.marginRight = '10px';
        iconDiv.style.flexShrink = '0';
        
        if (file.type === PDF_MIME) {
          iconDiv.style.backgroundColor = '#e53935';
          iconDiv.innerHTML = '<svg fill="#fff" width="24" height="24" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM16 18H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
        } else if (file.type.startsWith('image/')) {
          iconDiv.style.backgroundColor = '#4CAF50';
          iconDiv.innerHTML = '<svg fill="#fff" width="24" height="24" viewBox="0 0 24 24"><path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/></svg>';
        } else {
          iconDiv.style.backgroundColor = '#9E9E9E';
          iconDiv.innerHTML = '<svg fill="#fff" width="24" height="24" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-2 8c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm4 8H8v-.57c0-.81.48-1.53 1.22-1.85.85-.37 1.79-.58 2.78-.58.99 0 1.93.21 2.78.58.74.32 1.22 1.04 1.22 1.85V18z"/></svg>';
        }
        
        // File info
        const infoDiv = document.createElement('div');
        infoDiv.style.flex = '1';
        infoDiv.style.minWidth = '0';
        
        const nameDiv = document.createElement('div');
        nameDiv.textContent = file.name;
        nameDiv.style.fontWeight = 'bold';
        nameDiv.style.whiteSpace = 'nowrap';
        nameDiv.style.overflow = 'hidden';
        nameDiv.style.textOverflow = 'ellipsis';
        
        const sizeDiv = document.createElement('div');
        sizeDiv.textContent = formatFileSize(file.size);
        sizeDiv.style.fontSize = '12px';
        sizeDiv.style.color = '#666';
        
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(sizeDiv);
        
        // Actions
        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '5px';
        
        // Up button
        const upBtn = document.createElement('button');
        upBtn.innerHTML = '↑';
        upBtn.style.border = 'none';
        upBtn.style.backgroundColor = '#f0f0f0';
        upBtn.style.width = '30px';
        upBtn.style.height = '30px';
        upBtn.style.borderRadius = '4px';
        upBtn.style.cursor = 'pointer';
        upBtn.title = 'Move up';
        upBtn.disabled = i === 1; // Can't move up if it's right after cover page
        if (upBtn.disabled) {
          upBtn.style.opacity = '0.5';
          upBtn.style.cursor = 'default';
        }
        upBtn.addEventListener('click', () => {
          if (i > 1) { // Ensure it's not the first regular file
            moveFile(i, -1);
            updatePreview();
          }
        });
        
        // Down button
        const downBtn = document.createElement('button');
        downBtn.innerHTML = '↓';
        downBtn.style.border = 'none';
        downBtn.style.backgroundColor = '#f0f0f0';
        downBtn.style.width = '30px';
        downBtn.style.height = '30px';
        downBtn.style.borderRadius = '4px';
        downBtn.style.cursor = 'pointer';
        downBtn.title = 'Move down';
        downBtn.disabled = i === selectedFiles.length - 1;
        if (downBtn.disabled) {
          downBtn.style.opacity = '0.5';
          downBtn.style.cursor = 'default';
        }
        downBtn.addEventListener('click', () => {
          if (i < selectedFiles.length - 1) {
            moveFile(i, 1);
            updatePreview();
          }
        });
        
        // Remove button
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '×';
        removeBtn.style.border = 'none';
        removeBtn.style.backgroundColor = '#ffebee';
        removeBtn.style.color = '#e53935';
        removeBtn.style.width = '30px';
        removeBtn.style.height = '30px';
        removeBtn.style.borderRadius = '4px';
        removeBtn.style.cursor = 'pointer';
        removeBtn.style.fontSize = '20px';
        removeBtn.style.lineHeight = '0';
        removeBtn.title = 'Remove';
        removeBtn.addEventListener('click', () => {
          removeFile(i);
          updatePreview();
        });
        
        actionsDiv.appendChild(upBtn);
        actionsDiv.appendChild(downBtn);
        actionsDiv.appendChild(removeBtn);
        
        previewDiv.appendChild(iconDiv);
        previewDiv.appendChild(infoDiv);
        previewDiv.appendChild(actionsDiv);
        
        previewContainer.appendChild(previewDiv);
      }
    }
    
    function formatFileSize(size) {
      if (size < 1024) return size + ' B';
      if (size < 1024 * 1024) return Math.round(size / 1024) + ' KB';
      return Math.round(size / (1024 * 1024) * 10) / 10 + ' MB';
    }
    
    function moveFile(index, direction) {
      // Don't allow moving the cover page (index 0)
      if (index === 0) return;
      
      const newIndex = index + direction;
      // Don't allow moving files before cover page (index 0)
      if (newIndex <= 0 || newIndex >= selectedFiles.length) return;
      
      const temp = selectedFiles[index];
      selectedFiles[index] = selectedFiles[newIndex];
      selectedFiles[newIndex] = temp;
    }
    
    function removeFile(index) {
      // Don't allow removing the cover page (index 0)
      if (index === 0) return;
      
      selectedFiles.splice(index, 1);
    }
    
    // File input
    const fileInputContainer = document.createElement('div');
    fileInputContainer.style.backgroundColor = '#f8f8f8';
    fileInputContainer.style.padding = '15px';
    fileInputContainer.style.borderRadius = '6px';
    fileInputContainer.style.border = '2px dashed #ddd';
    fileInputContainer.style.display = 'flex';
    fileInputContainer.style.flexDirection = 'column';
    fileInputContainer.style.alignItems = 'center';
    fileInputContainer.style.justifyContent = 'center';
    fileInputContainer.style.textAlign = 'center';
    fileInputContainer.style.cursor = 'pointer';
    
    const fileIcon = document.createElement('div');
    fileIcon.innerHTML = '<svg fill="#999" width="40" height="40" viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/></svg>';
    
    const fileText = document.createElement('div');
    fileText.style.marginTop = '10px';
    fileText.style.fontWeight = 'bold';
    fileText.innerHTML = 'Click or drop files here<br><span style="font-weight:normal;font-size:12px;color:#666;">PDF, JPG, PNG, GIF accepted</span>';
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.pdf,image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    
    fileInputContainer.appendChild(fileIcon);
    fileInputContainer.appendChild(fileText);
    fileInputContainer.appendChild(fileInput);
    
    fileInputContainer.addEventListener('click', () => {
      fileInput.click();
    });
    
    // Handle file drop
    fileInputContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      fileInputContainer.style.backgroundColor = '#f0f0f0';
      fileInputContainer.style.borderColor = '#aaa';
    });
    
    fileInputContainer.addEventListener('dragleave', () => {
      fileInputContainer.style.backgroundColor = '#f8f8f8';
      fileInputContainer.style.borderColor = '#ddd';
    });
    
    fileInputContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      fileInputContainer.style.backgroundColor = '#f8f8f8';
      fileInputContainer.style.borderColor = '#ddd';
      
      if (e.dataTransfer.files.length > 0) {
        handleNewFiles(e.dataTransfer.files);
      }
    });
    
    function handleNewFiles(fileList) {
      let added = 0;
      
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        
        // Check if file type is accepted
        if (file.type === PDF_MIME || IMAGE_MIME_TYPES.includes(file.type)) {
          selectedFiles.push(file);
          added++;
        }
      }
      
      if (added > 0) {
        updatePreview();
      }
      
      return added;
    }
    
    // Add file input
    fileInput.addEventListener('change', (e) => {
      const added = handleNewFiles(e.target.files);
      if (added > 0) {
        // Scroll to show previews
        previewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    
    content.appendChild(previewContainer);
    content.appendChild(fileInputContainer);
    
    // Footer with buttons
    const footer = document.createElement('div');
    footer.style.padding = '15px 20px';
    footer.style.borderTop = '1px solid #eee';
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.backgroundColor = '#f9f9f9';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '10px 16px';
    cancelBtn.style.border = '1px solid #ddd';
    cancelBtn.style.backgroundColor = '#f5f5f5';
    cancelBtn.style.borderRadius = '4px';
    cancelBtn.style.cursor = 'pointer';
    cancelBtn.style.marginRight = '10px';
    
    const submitBtn = document.createElement('button');
    submitBtn.innerHTML = '<svg fill="#fff" width="16" height="16" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Create & Attach Defense PDF';
    submitBtn.style.padding = '10px 20px';
    submitBtn.style.border = 'none';
    submitBtn.style.backgroundColor = '#f44336';
    submitBtn.style.color = '#fff';
    submitBtn.style.borderRadius = '4px';
    submitBtn.style.cursor = 'pointer';
    submitBtn.style.fontWeight = 'bold';
    submitBtn.style.display = 'flex';
    submitBtn.style.alignItems = 'center';
    submitBtn.style.gap = '8px';
    submitBtn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    submitBtn.style.transition = 'background-color 0.2s, transform 0.1s';
    
    submitBtn.addEventListener('mouseover', () => {
      submitBtn.style.backgroundColor = '#e53935';
    });
    
    submitBtn.addEventListener('mouseout', () => {
      submitBtn.style.backgroundColor = '#f44336';
    });
    
    submitBtn.addEventListener('mousedown', () => {
      submitBtn.style.transform = 'scale(0.98)';
    });
    
    submitBtn.addEventListener('mouseup', () => {
      submitBtn.style.transform = 'scale(1)';
    });
    
    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);
    
    modal.appendChild(header);
    modal.appendChild(content);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    
    document.body.appendChild(overlay);
    
    // Initial preview update
    updatePreview();
    
    // CLOSE
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    
    // CANCEL
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    
    // SUBMIT => Merge & Download
    submitBtn.addEventListener('click', async () => {
      if (selectedFiles.length === 1) {
        alert('Please add supporting documents to your defense package!');
        return;
      }
      
      // Update UI to show processing
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<div style="width:16px;height:16px;border:2px solid #fff;border-top-color:transparent;border-radius:50%;animation:defender-spin 0.8s linear infinite;margin-right:8px;"></div> Processing...';
      const styleEl = document.createElement('style');
      styleEl.textContent = '@keyframes defender-spin {0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); }}';
      document.head.appendChild(styleEl);
      
      try {
        // Show step 3 as active
        step2Circle.style.backgroundColor = '#4CAF50';
        step2Circle.innerHTML = '✓';
        step2Text.style.color = '#4CAF50';
        connector2.style.backgroundColor = '#4CAF50';
        step3Circle.style.backgroundColor = '#f44336';
        step3Circle.style.color = 'white';
        step3Text.style.color = '#333';
        step3Text.style.fontWeight = 'bold';
        
        console.log('Starting defense PDF creation process...');
        
        // Convert each File => arrayBuffer (skip the first one, which is the cover page)
        const filesInfo = [];
        for (let i = 1; i < selectedFiles.length; i++) {
          let file = selectedFiles[i];
          console.log(`Processing file ${i}/${selectedFiles.length-1}: ${file.name}`);
          let ab = await file.arrayBuffer();
          filesInfo.push({ file, arrayBuffer: ab });
        }
        
        // First, let's create an array buffer from the coverPageBytes
        console.log('Processing cover page');
        const coverPageArrayBuffer = await coverPageFile.arrayBuffer();
        
        // Merge all files with cover page
        console.log('Merging files into final PDF');
        const mergedPdfBytes = await mergeDefenderFiles(coverPageArrayBuffer, filesInfo);
        
        // We'll rename the final PDF as "<RefNum>.pdf" or fallback to "defense_document.pdf"
        const finalPdfName = (refNum ? refNum : 'defense_document') + '.pdf';
        console.log(`Creating final PDF: ${finalPdfName}`);
        
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
        console.log('Attaching PDF to Zendesk composer');
        const pdfFile = new File([blob], finalPdfName, { type: PDF_MIME });
        attachFileToComposer(pdfFile);
        
        // 4) Show success message briefly before closing
        submitBtn.style.backgroundColor = '#4CAF50';
        submitBtn.innerHTML = '<svg fill="#fff" width="16" height="16" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg> Defense PDF Created Successfully!';
        
        // Close modal after a brief delay
        setTimeout(() => {
          document.body.removeChild(overlay);
        }, 1500);
        
      } catch (err) {
        console.error('Error creating defense PDF:', err);
        alert('Error creating defense PDF: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<svg fill="#fff" width="16" height="16" viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> Create & Attach Defense PDF';
      }
    });
  }

})();
