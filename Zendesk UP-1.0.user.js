// ==UserScript==
// @name         Zendesk UP
// @namespace    https://your-namespace.example
// @version      1.0
// @description  "UP" button for Zendesk: sets "UP - Referencia," sets "Tipología" text field, then inserts multiple snippet lines into CKEditor, with only one greeting/farewell
// @author       You
// @match        https://okmobility.zendesk.com/*
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  /***************************************************************/
  /*** 1) SUBJECT & FIELDS: "UP - Referencia" / "Tipología"    ***/
  /***************************************************************/

  const SUBJECT_SELECTOR = '[data-test-id="omni-header-subject"]';
  const REFERENCIA_LABEL = 'UP - Referencia';
  const TIPOLOGIA_LABEL = 'Tipología de Reclamación (Retrocesos)';

  // read subject
  function getTicketSubject() {
    const el = document.querySelector(SUBJECT_SELECTOR);
    return el ? el.value.trim() : '';
  }

  // e.g. "3" + >=4 digits => total >=5
  function extractRefNumber(text) {
    const re = /\b(3\d{4,})\b/;
    const match = re.exec(text);
    return match ? match[1] : null;
  }

  // set text field by label
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
  /**
   * We'll replicate your older approach:
   *  - `setReplyText()` splits text by lines
   *  - For each line => `insertTextInCKEditor(...)` triggers synthetic "beforeinput" + physically inserts a text node, then an "input" event.
   */
  function setReplyText(fullMessage) {
    const editorDiv = document.querySelector('.ck.ck-content[contenteditable="true"]');
    if (!editorDiv) {
      console.warn('No CKEditor editor found. Cannot paste text lines.');
      return;
    }
    editorDiv.focus();

    // unify CRLF => LF
    fullMessage = fullMessage.replace(/\r\n/g, '\n');
    // Split lines
    const lines = fullMessage.split('\n');
    // Insert each line, plus a newline if not the last
    for (let i = 0; i < lines.length; i++) {
      insertTextInCKEditor(editorDiv, lines[i]);
      if (i < lines.length - 1) {
        insertTextInCKEditor(editorDiv, '\n');
      }
    }

    // blur/focus so CKEditor updates
    editorDiv.blur();
    setTimeout(() => editorDiv.focus(), 50);
  }

  function insertTextInCKEditor(editorDiv, chunk) {
    // 1) create range at end
    const range = document.createRange();
    if (editorDiv.lastChild) {
      range.setStartAfter(editorDiv.lastChild);
      range.setEndAfter(editorDiv.lastChild);
    } else {
      range.setStart(editorDiv, 0);
      range.setEnd(editorDiv, 0);
    }

    // 2) create static range
    const staticRange = new StaticRange({
      startContainer: range.startContainer,
      startOffset:   range.startOffset,
      endContainer:  range.endContainer,
      endOffset:     range.endOffset
    });

    // 3) dispatch "beforeinput"
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

    // 4) insert text node
    const textNode = document.createTextNode(chunk);
    range.insertNode(textNode);

    // 5) move range after inserted text
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);

    // 6) final "input" event
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
  /***********************************************/

  // short text for ACEPTAR
  const ACEPTAR_TEXT = [
    "Dear Partner,",
    "",
    "Thanks for your email.",
    "",
    "We accept the proposed chargeback."
  ].join('\n');

  // We'll do "Dear Partner,\n\n...snippets...\n\nKind regards,"
  const GREETING = "Dear Partner,\n";
  const FAREWELL = "\nKind regards,";

  // The list of cause names
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

  // The text-only body for each cause (minus "Dear Partner," and "Kind regards,")
  const DEFENDER_SNIPPETS = {
    "Cargo – Daños": `
Cargo – Daños

Thank you for reaching out regarding the disputed charge for vehicle damages. We would like to clarify the following points, as set forth in our General Conditions:

Coverage Options
Additional Coverage (OK PREMIUM COVER or similar): Limits your liability for potential damages.
Declining Additional Coverage: Requires a deposit (deductible) ranging from €900 to €4,000 (depending on the vehicle segment), which acts as a guarantee.

Deposit and Pre-Authorization
Under point 9 of the General Conditions, customers who do not opt for additional coverage must provide a pre-authorization to cover the deductible and any potential damages. The amount is refunded if the vehicle is returned in the same condition. In the event of new damages, the corresponding charge is deducted from this blocked amount, along with an administrative fee for damage management.

Damage Charges
Damage Table (Annex): Charges are calculated based on a price table for each affected component, which the customer agrees to upon signing the contract.
Vehicle Inspection: We encourage customers to inspect the vehicle at pick-up and report any unrecorded damage. This ensures that only new damages found upon return pertain to the customer’s rental period.

Evidence of New Damages
Given the customer’s refusal to acknowledge the charge, we have documented the newly discovered damages with photographs. These images confirm that the damage occurred during the rental period, aligning with our contractual terms.

Please find attached all relevant rental documentation, including the pre-authorization ticket and photos of the vehicle. We remain at your disposal for any additional inquiries.
`.trim(),

    "Cargo - Asistencia": `
Cargo - Asistencia

Referring to the disputed charge for towing/roadside assistance, we would like to clarify the following:

Coverage Options and Responsibilities
At the time of rental, customers may opt for specific coverage that includes roadside assistance—such as our Roadside Assistance Service (CAR), OK PREMIUM COVER, or OK SUPER PREMIUM COVER. These coverages typically waive or reduce the customer’s financial liability for certain incidents. However, if the customer did not purchase such coverage or if the incident resulted from negligence or unauthorized use, the cost of the tow truck/road assistance falls entirely on the customer.

General Conditions (Point 9 & 9.1.1)
In our General Conditions, particularly point 9 (Coverage) and point 9.1.1 (Roadside Assistance Service – CAR), it is clearly stated that assistance costs may not be covered if the customer has not contracted the corresponding coverage or if the breakdown occurs due to improper or unauthorized use of the vehicle.

Customer’s Explicit Agreement
The customer’s signature on the Rental Agreement indicates their acceptance of these conditions, including their responsibility to bear any towing or road assistance costs not covered by the chosen coverage.

Supporting Documentation
We have attached copies of the relevant rental documentation (signed agreement and coverage selection), as well as any available service report or invoice detailing the towing/roadside assistance charges.

Should you require more information, we remain at your disposal.
`.trim(),

    "Cargo - Abandono": `
Cargo - Abandono

Referring to the disputed charge for allegedly abandoning the vehicle, we wish to highlight:

Vehicle Return Obligations
Under point 2 of our General Conditions, the Lessee agrees to return (check in) the vehicle at the agreed place and time. If the Lessee fails to return the vehicle as stipulated or leaves it parked or abandoned without properly completing the check-in process, they are liable for the costs related to the vehicle’s recovery.

Recovery Fee and Associated Costs
When a vehicle is not returned properly, all recovery and administrative costs fall on the customer, as per the same point in our General Conditions and the applicable fees in our Annex (including potential daily rental charges until the vehicle is retrieved).

Customer’s Acceptance
The customer explicitly accepted these contractual obligations upon signing the Rental Agreement. The Terms and Conditions clearly outline that abandoning the vehicle triggers a fee for recovering it, plus any additional expenses.

Documentation and Evidence
We have attached the rental documentation and any evidence (e.g., photographs or notes from our recovery team) confirming that the vehicle was not returned correctly, thereby necessitating towing or other recovery measures.

We are available for any further clarifications.
`.trim(),

    "Cargo – Cancelación NR": `
Cargo – Cancelación NR

Referring to the disputed charge and the customer’s request to refund a non-refundable booking, we would like to clarify:

Choice of Non-Refundable Rate
In our General Conditions (point 8.1.4 and reinforced by our Cancellation Policy in point 22), the Lite Rate (or any other non-refundable rate the customer selected) does not admit any reimbursement once the booking is confirmed, unless a strictly documented force majeure situation applies.

Customer’s Explicit Consent
By choosing the non-refundable rate, the customer agreed to its conditions:
No right to cancellation and no refund.
This policy is clearly displayed during the booking process and reiterated in the Rental Agreement.

Cancellation/Refund Limitations
In line with point 22 of our General Conditions, all cancellations must be requested in writing, and non-refundable bookings are not subject to reimbursement. Any exception (e.g., force majeure) must be documented and evaluated according to the policy terms.

Attached Documentation
We have attached the customer’s signed booking confirmation, which states the rate type and the corresponding non-refundable clause. The booking conditions were accepted by the customer at the time of reservation.

Given these points, we regret to inform you that no refund can be issued for this booking. We remain at your disposal for any questions.
`.trim(),

    "Cargo – Limpieza": `
Cargo – Limpieza

Referring to the disputed cleaning fee charge, please note the following:

Condition of the Vehicle Upon Return
According to point 4.2 of our General Conditions, the Lessee is required to return the vehicle in a reasonably clean condition, both inside and outside. If the vehicle is returned requiring extraordinary cleaning (e.g., excessive dirt, garbage, stains, strong odors, etc.), an additional fee is charged.

Customer’s Obligation
The customer explicitly accepted these provisions by signing the Rental Agreement. Therefore, any necessary special or additional cleaning that goes beyond normal usage is billed according to our price schedule, which is outlined in the Annex attached to the T&C.

Supporting Evidence
We have photographs and/or documentation showing the condition of the vehicle upon return, clearly indicating that additional cleaning services were needed. These are available upon request.

We remain at your disposal for any clarifications.
`.trim(),

    "Cargo – Combustible": `
Cargo – Combustible

Referring to the disputed charge for fuel, we would like to clarify:

Fuel Policy
In compliance with point 14 of our General Conditions, vehicles must be returned with the same fuel level as provided at check-out. Failing to do so may incur refueling costs along with a refueling management fee (stated in our Annex).

Customer’s Responsibility
The customer was informed of this policy and acknowledged it upon signing the Rental Agreement. The customer also had the option to choose a “Full/Full” or “Full/Refund” plan, both of which require returning the vehicle with a specified fuel level.

Evidence of Shortfall
Our records (fuel gauge reading, pump receipt, photos, etc.) show that the customer returned the car with less fuel than at check-out. Consequently, the agreed fee was applied in accordance with the T&C and as authorized by the customer’s signature.

We stand ready to provide additional details upon request.
`.trim(),

    "Cargo – Kilometraje": `
Cargo – Kilometraje

Referring to the disputed charge for exceeding the mileage allowance, we would like to highlight:

Mileage Limitation
As stated in point 16 of our General Conditions, the rental agreement includes a daily mileage limit (e.g., 300 km/day, up to a maximum of 3,000 km, or unlimited mileage in certain territories). Exceeding this mileage limit triggers an additional per-kilometer charge, specified in the Annex.

Customer’s Agreement
Upon signing the Rental Agreement, the customer acknowledged this limitation. The daily limit or unlimited mileage conditions are clearly indicated in the specific contract details.

Exceeding the Allowance
Our vehicle monitoring system and/or returned odometer reading indicate that the customer exceeded the permitted mileage. Hence, the additional mileage fee was applied per the signed contract and T&C.

For more information, we have attached relevant documentation indicating the total kilometers driven during the rental period.
`.trim(),

    "Cargo – One Way": `
Cargo – One Way

We are writing concerning the disputed one-way fee charge:

Drop-Off Location and Terms
Under point 2 of our General Conditions, the vehicle must be returned to the same Store where the contract was signed, unless a specific “One Way” service was selected and agreed upon. Dropping off the vehicle at a different location without prior authorization is prohibited or subject to additional fees.

Customer’s Obligation
The customer had the option to book a permitted One Way service, where an extra fee is applied and included in the Rental Agreement. However, if the customer did not book or pay for One Way and still dropped the vehicle at another location, they are liable for the corresponding penalty or recovery costs.

Contractual Acceptance
By signing the Rental Agreement, the customer accepted all obligations related to the return location. Therefore, the additional charge is valid according to the T&C and the Annex fee schedule.

Please find attached the relevant documentation confirming the drop-off location and the associated fee details.
`.trim(),

    "Cargo – Fumar": `
Cargo – Fumar

In response to the disputed smoking fee charge, we offer the following clarification:

Non-Smoking Policy
As stated in point 11 of our General Conditions, smoking inside the vehicle is strictly prohibited. Doing so may result in a penalty or a special cleaning charge to remove odors and residues.

Inspection Findings
Upon returning the vehicle, our inspection found clear evidence of smoking (e.g., smell of tobacco, ash traces, cigarette burns). As per the T&C and the Annex, the associated fee is assessed for additional cleaning and decontamination.

Customer’s Acceptance
The customer explicitly accepted these terms upon signing the contract. Therefore, the fee is charged in accordance with the T&C to restore the vehicle to its non-smoking condition.
`.trim(),

    "Cargo – After Hours": `
Cargo – After Hours

Regarding the disputed after-hours charge, we would like to outline the following:

Pickup and Return Schedule
In point 2.3 of our General Conditions, it is specified that any check-in or check-out of the vehicle outside the Store’s regular opening hours incurs an additional fee. This cost is detailed in the Annex.

Customer’s Advance Notice
The customer was informed of our store’s operating hours and the associated fees for requesting an out-of-hours service. By confirming the reservation and signing the agreement, the customer consented to these terms.

Justification of Charge
Our records indicate the vehicle was picked up or returned outside normal operating hours, thereby necessitating staff availability beyond our standard schedule. Hence, we applied the corresponding surcharge in line with the T&C.
`.trim(),

    "Cargo – OPC/CAR": `
Cargo – OPC/CAR

Referring to the disputed charges for additional coverage (OK PREMIUM COVER and/or Roadside Assistance), please consider:

Coverage Terms
Point 9 of our General Conditions details the coverage options available to customers, including potential waivers of the excess, roadside assistance benefits, etc.

Voluntary Selection & Usage
The customer voluntarily selected and enjoyed these additional coverages during the rental period. Once activated and used, these services are non-refundable—even if the customer did not file a claim.

Non-Refundable Policy
Our T&C clearly specify that coverage costs apply for the entire rental period; there is no partial or full refund if the coverage has been in effect for any or all of the rental duration.

Customer Acknowledgment
By signing the Rental Agreement, the customer acknowledged and agreed to pay for these coverage services in full.

Consequently, the charge in question is legitimate under our contractual terms.
`.trim(),

    "Cargo - Upselling": `
Cargo - Upselling

Thank you for contacting OK Mobility.

Regarding the disputed charge for an upgraded (higher category) vehicle, our records indicate the following:

Voluntary Upgrade
According to our documentation, you were offered a higher category vehicle at an additional cost. By signing the contract and entering your payment PIN, you explicitly accepted this upgrade and its corresponding charges.

Fleet Availability
Under our General Conditions, if a fleet shortage or lack of availability occurs in the vehicle category originally reserved, we provide a vehicle of a higher category free of charge. However, in this instance, we have no record of such a shortage. Instead, the upgrade was a voluntary choice on your part.

Non-Refundable Once Used
Since you enjoyed the upgraded vehicle throughout your rental period, we regret to inform you that no reimbursement is applicable for services already provided and utilized.

We apologize for any inconvenience caused. Should you have any further questions or require additional information, we remain at your disposal.
`.trim(),

    "Reserva disfrutada": `
Reserva disfrutada

We are writing regarding the customer’s refund request for a reservation that was fully used:

Service Fulfillment
According to our records and rental documentation, the customer proceeded with vehicle pickup (Check-Out) and utilized the booked rental. Therefore, the service was rendered in full, as outlined in point 2 of our General Conditions regarding the rental period and proper Check-In/Check-Out procedures.

Completion of Contract
Once a reservation has been honored and the vehicle has been used, the full rental contract and its corresponding terms apply. As stated in point 8 of our T&C, all agreed-upon charges for the reserved period become due when the service is provided.

No Grounds for Refund
In alignment with point 22 (Cancellation Policy), refunds may be considered only before or at the start of the rental period for specific rate types (e.g., Premium Rate or Standard Rate, under certain conditions). However, in this case, the reservation has been fulfilled with the vehicle in use, thus no refund is applicable.

Customer’s Agreement
By signing the Rental Agreement and utilizing the booking, the customer accepted these terms. We have attached all supporting documentation, including the signed contract and usage records.

We trust this clarifies the reason no refund can be issued. We remain at your disposal for any further questions.
`.trim(),

    "Reserva NR": `
Reserva NR

We refer to the customer’s request to cancel a non-refundable booking. Below are the relevant points:

Non-Refundable Rate Selection
In point 8.1.4 of our General Conditions, it specifies our Lite Rate (or another designated non-refundable rate) does not permit refunds or changes once the booking is confirmed.

Cancellation Policy
As highlighted in point 22 (Cancellation Policy) of the T&C, no refunds are issued for non-refundable bookings. This is clearly indicated at the time of reservation and accepted by the customer when finalizing the booking.

Explicit Acknowledgment
During the reservation process (either online or in-store), the customer was informed of the non-refundable nature of this rate. Proceeding with the booking means the customer explicitly agreed to these terms.

Documentation
Please see attached the booking confirmation and rate details reflecting the non-refundable policy and the customer’s acceptance.

In light of the above, we regret that no refund can be issued. We are available for any additional clarification.
`.trim(),

    "Retención": `
Retención

Regarding the customer’s concern over the preauthorized (blocked) amount on their payment card:

Excess/Deposit Policy
Point 9 and 9.2 of our General Conditions establish that, when no additional coverage or partial coverage is chosen, a security deposit (or excess) preauthorization ranging from €900 to €4,000 is placed on the customer’s credit card according to the vehicle’s group/segment.

Purpose of the Preauthorization
The deposit acts as a guarantee to cover potential damages, traffic penalties, refueling, or any other charges identified at the vehicle’s return. Once the rental concludes and if no incident is detected, point 9.2 clarifies that the withheld or blocked amount is automatically released.

Release of Funds
Our records show that after the vehicle’s check-in and inspection, no additional charges were identified. Therefore, we promptly initiated the release of the preauthorized amount. The timeline for the funds to appear back on the customer’s account depends on their bank’s processing times.

Customer Authorization
The customer agreed to the deposit block by signing the Rental Agreement, which includes a clear explanation in the T&C regarding the preauthorization and subsequent release process.

Please see the attached documentation, including the signed rental contract and proof of the deposit release.
`.trim()
  };

  // merges all chosen snippets with newlines, then wraps greeting/farewell
  function buildDefenderMessage(selectedCauses) {
    let bodyLines = [];
    for (let cause of selectedCauses) {
      const snippet = DEFENDER_SNIPPETS[cause] || (cause + " (no snippet found)");
      bodyLines.push(snippet);
    }
    // We'll separate each snippet with 1 blank line
    const combinedBody = bodyLines.join('\n\n');
    return GREETING + '\n' + combinedBody + '\n' + FAREWELL;
  }

  /***********************************************************/
  /*** 4) MULTI-SELECT POPUP (SAME FOR ACEPTAR/DEFENDER)   ***/
  /***********************************************************/

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

  /**************************************************/
  /*** 5) INJECT THE "UP" BUTTON & MAIN LOGIC     ***/
  /**************************************************/

  const FOOTER_CONTAINER_SELECTOR = '.sc-177ytgv-1.WxSHa';

  function injectUpButtons() {
    if (document.getElementById('btnUpMain')) return; // avoid duplicates

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
        alert('No valid reference found in subject (3 + >=4 digits)!');
        return;
      }
      setTextFieldByLabel(REFERENCIA_LABEL, refNum);

      // popup for cause(s)
      const chosen = await showDefenderPopup();
      if (!chosen || chosen.length === 0) {
        // just do short text
        setReplyText(ACEPTAR_TEXT);
        alert('No causes selected. Short accept text inserted.');
        return;
      }
      // set tipologia to the first cause
      setTextFieldByLabel(TIPOLOGIA_LABEL, chosen[0]);
      // Insert short accept text
      setReplyText(ACEPTAR_TEXT);
      alert(`Ref #${refNum}. Tipología='${chosen[0]}'. Inserted short accept text.`);
    });

    // DEFENDER => merges
    defenderBtn.addEventListener('click', async () => {
      const subj = getTicketSubject();
      const refNum = extractRefNumber(subj);
      if (!refNum) {
        alert('No valid reference found in subject (3 + >=4 digits)!');
        return;
      }
      setTextFieldByLabel(REFERENCIA_LABEL, refNum);

      const chosen = await showDefenderPopup();
      if (!chosen || chosen.length === 0) {
        alert('No causes selected => do nothing.');
        return;
      }
      // set tipologia to first cause
      setTextFieldByLabel(TIPOLOGIA_LABEL, chosen[0]);

      // single greeting, then each snippet, then single farewell
      const finalMsg = buildDefenderMessage(chosen);
      setReplyText(finalMsg);
      alert(`Ref #${refNum}. Tipología='${chosen[0]}'. Inserted multi-cause text (single greeting/farewell).`);
    });
  }

  // poll to inject
  const interval = setInterval(() => {
    injectUpButtons();
    if (document.getElementById('btnUpMain')) {
      console.log('UP button loaded with single greeting/farewell & line-based insertion');
      clearInterval(interval);
    }
  }, 1500);

})();
