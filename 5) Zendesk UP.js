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
  function setReplyText(fullMessage) {
    const editorDiv = document.querySelector('.ck.ck-content[contenteditable="true"]');
    if (!editorDiv) {
      console.warn('No CKEditor editor found. Cannot paste text lines.');
      return;
    }
    editorDiv.focus();

    fullMessage = fullMessage.replace(/\r\n/g, '\n');
    const lines = fullMessage.split('\n');
    for (let i = 0; i < lines.length; i++) {
      insertTextInCKEditor(editorDiv, lines[i]);
      if (i < lines.length - 1) {
        insertTextInCKEditor(editorDiv, '\n');
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
  const ACEPTAR_TEXT = [
    "Dear Partner,",
    "",
    "Thanks for your email.",
    "",
    "We accept the proposed chargeback."
  ].join('\n');

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

  const DEFENDER_SNIPPETS = {
    "Cargo – Daños": `Short snippet or long snippet...`,
    "Cargo - Asistencia": `Another snippet...`,
    // etc...
  };

  function buildDefenderMessage(selectedCauses) {
    let bodyLines = [];
    for (let cause of selectedCauses) {
      const snippet = DEFENDER_SNIPPETS[cause] || (cause + " (no snippet found)");
      bodyLines.push(snippet);
    }
    const combinedBody = bodyLines.join('\n\n');
    return GREETING + '\n' + combinedBody + '\n' + FAREWELL;
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
        width: 400px; max-width: 90%; box-shadow: 0 0 10px rgba(0,0,0,0.5);
        position: relative;
      }
      #archivosDragArea {
        border: 2px dashed #ccc; padding: 20px; text-align: center;
        margin-bottom: 10px;
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

    const submitBtn = document.createElement('button');
    submitBtn.id = 'archivosSubmit';
    submitBtn.textContent = 'Merge & Download PDF';

    modal.appendChild(closeBtn);
    modal.appendChild(dragArea);
    modal.appendChild(fileInput);
    modal.appendChild(submitBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // We'll store selected files
    let selectedFiles = [];

    function handleNewFiles(fileList) {
      for (let file of fileList) {
        // only add if PDF or recognized image
        if (file.type === PDF_MIME || IMAGE_MIME_TYPES.includes(file.type)) {
          // (Optionally check for duplicates)
          selectedFiles.push(file);
        } else {
          alert(`Skipping file "${file.name}" – not a PDF or recognized image type.`);
        }
      }
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
      handleNewFiles(e.dataTransfer.files);
    });

    // FILE input
    fileInput.addEventListener('change', (e) => {
      handleNewFiles(e.target.files);
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
      // Convert each File => arrayBuffer
      const filesInfo = [];
      for (let f of selectedFiles) {
        let ab = await f.arrayBuffer();
        filesInfo.push({ file: f, arrayBuffer: ab });
      }
      try {
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
        setReplyText(ACEPTAR_TEXT);
        alert('No causes selected. Short accept text inserted.');
        return;
      }
      setTextFieldByLabel(TIPOLOGIA_LABEL, chosen[0]);
      setReplyText(ACEPTAR_TEXT);
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
      const finalMsg = buildDefenderMessage(chosen);
      setReplyText(finalMsg);
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