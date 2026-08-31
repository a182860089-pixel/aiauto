const CORE_FIELD_KEYS = ['PatientName', 'HospitalNo', 'Diagnosis', 'DiagnosisWestern', 'CreationTime']
const SKIP_FILL_KEYS = new Set(['Department', 'VisitRole'])
const SUBMIT_TARGETS = ['确定', '确认', '保存']
const FIELD_TARGETS = {
  PatientName: '病人姓名',
  HospitalNo: '住院号',
  Diagnosis: '中医诊断',
  DiagnosisWestern: '西医诊断',
  CreationTime: '住院日期',
  Remarks: '备注',
  VisitRole: '主管',
}
const FIELD_NAMES = {
  PatientName: ['PatientName', '病人姓名'],
  HospitalNo: ['HospitalNo', 'HospitalizationCode', '住院号'],
  Diagnosis: ['Diagnosis', '中医诊断'],
  DiagnosisWestern: ['DiagnosisWestern', '西医诊断'],
  CreationTime: ['CreationTime', '住院日期'],
  Remarks: ['Remarks', '备注'],
  VisitRole: ['Visit', 'VisitRole', '主管'],
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function coreFieldValues(fields) {
  var preferred = CORE_FIELD_KEYS
    .map((key) => String(fields?.[key] || '').trim())
    .filter(Boolean)
  if (preferred.length) return preferred
  return Object.values(fields || {}).map((value) => String(value || '').trim()).filter(Boolean)
}

function getFillableFieldEntries(fields) {
  var seen = new Set()
  return CORE_FIELD_KEYS.concat(Object.keys(fields || {})).filter((key) => {
    if (seen.has(key) || SKIP_FILL_KEYS.has(key) || !String(fields?.[key] || '').trim()) return false
    seen.add(key)
    return true
  }).map((key) => ({
    key,
    target: FIELD_TARGETS[key] || key,
    names: FIELD_NAMES[key] || [key, FIELD_TARGETS[key] || key],
    value: String(fields[key]),
  }))
}

function getObservationControls(observation) {
  return [
    ...(observation?.main?.controls || []),
    ...(observation?.frames || []).flatMap((frame) => frame.controls || []),
  ]
}

function areTargetFieldsFilled(observation, fields) {
  var expectedValues = coreFieldValues(fields)
  if (expectedValues.length === 0) return false
  var currentValues = getObservationControls(observation).map((control) => String(control.value || ''))
  return expectedValues.every((value) => currentValues.includes(value))
}

function getFillRecords(payload) {
  if (Array.isArray(payload?.records) && payload.records.length) {
    return payload.records.map((record, index) => ({
      id: String(record?.id || `record-${index}`),
      fields: record?.fields && typeof record.fields === 'object' ? record.fields : {},
    })).filter((record) => coreFieldValues(record.fields).length > 0)
  }
  if (payload?.fields && coreFieldValues(payload.fields).length) {
    return [{ id: 'record-0', fields: payload.fields }]
  }
  return []
}

function normalizeHospitalNo(value) {
  return String(value || '').replace(/\s+/g, '')
}

function recordHospitalNo(recordOrFields) {
  var fields = recordOrFields?.fields && typeof recordOrFields.fields === 'object' ? recordOrFields.fields : recordOrFields
  return normalizeHospitalNo(fields?.HospitalNo || fields?.HospitalizationCode)
}

function dedupeFillRecords(records) {
  var seen = new Set()
  var unique = []
  var skipped = []
  ;(records || []).forEach((record) => {
    var hospitalNo = recordHospitalNo(record)
    if (hospitalNo && seen.has(hospitalNo)) {
      skipped.push(record)
      return
    }
    if (hospitalNo) seen.add(hospitalNo)
    unique.push(record)
  })
  return { records: unique, skipped }
}

function isExistingRecord(listed, fields) {
  var hospitalNo = recordHospitalNo(fields)
  if (!hospitalNo) return false
  var rows = listed?.rows || listed || []
  if (rows.some((row) => {
    if (normalizeHospitalNo(row.HospitalNo || row.HospitalizationCode) === hospitalNo) return true
    return (row.cells || []).some((cell) => normalizeHospitalNo(cell) === hospitalNo)
  })) return true
  var tokens = String(listed?.text || '').split(/\s+/).map(normalizeHospitalNo).filter(Boolean)
  return tokens.includes(hospitalNo)
}

function shouldSubmit(payload) {
  return payload?.submit !== false
}

function isCreateSrc(src) {
  var text = String(src || '')
  if (text.includes('/HospitalizationRecord/Create')) return true
  if (text.includes('/HospitalizationRecord/Detail') && (/[?&]type=Add\b/i.test(text) || /\/Detail\/0(\b|\?|$)/.test(text))) return true
  return false
}

function frameHasCreateFields(frame) {
  return (frame?.controls || []).some((control) => {
    var haystack = [control.name, control.id].join(' ')
    return /HospitalizationCode/.test(haystack)
  })
}

function getCreateFrame(observation) {
  return (observation?.frames || []).find((frame) => isCreateSrc(frame.src) || frameHasCreateFields(frame))
}

function createFrameHasInputs(createFrame) {
  return (createFrame?.controls || []).some((control) => {
    var tag = String(control.tag || '').toUpperCase()
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(control.placeholder || control.name)
  })
}

function isCreateFormOpen(observation) {
  if (getCreateFrame(observation)) return true
  return getObservationControls(observation).some((control) => /HospitalizationCode/.test([control.name, control.id].join(' ')))
}

function getNextMissingFieldAction(observation, fields) {
  var createFrame = getCreateFrame(observation)
  if (!createFrame || !createFrameHasInputs(createFrame)) return null
  var currentValues = (createFrame.controls || []).map((control) => String(control.value || ''))
  var missingField = getFillableFieldEntries(fields).find((field) => !currentValues.includes(field.value))
  return missingField
    ? { action: 'fill', target: missingField.target, value: missingField.value, message: '填写剩余字段', fieldKey: missingField.key }
    : null
}

function isSubmitTarget(target) {
  return SUBMIT_TARGETS.includes(String(target || '').trim())
}

function withoutSubmitActions(actions) {
  return (actions || []).filter((action) => !(action.action === 'click' && isSubmitTarget(action.target)))
}

function observationText(observation) {
  return [
    observation?.main?.text || '',
    ...(observation?.frames || []).map((frame) => frame.text || ''),
  ].join('\n')
}

function hasControlText(observation, target) {
  var needle = String(target || '').trim()
  if (!needle) return false
  return getObservationControls(observation).some((control) => String(control.text || '').includes(needle))
}

function pageKind(observation) {
  var url = String(observation?.url || '')
  var sources = [url, ...(observation?.frames || []).map((frame) => String(frame.src || ''))]
  if (sources.some(isCreateSrc) || getCreateFrame(observation)) return 'create'
  var combined = sources.join('\n')
  if (combined.includes('/HospitalizationRecord/Index')) return 'index'
  if (combined.includes('/Home/Login')) return 'login'
  return 'home'
}

function summarizeObservation(observation) {
  var srcs = (observation?.frames || []).map((frame) => {
    var src = String(frame.src || '').replace(/^https?:\/\/[^/]+/i, '')
    return `${src || '无src'}${frame.accessible === false ? '(不可读)' : ''}`
  })
  return `页面=${pageKind(observation)} 框架=${srcs.join(' | ') || '无'} 控件=${getObservationControls(observation).length}`
}

/**
 * 已知规培平台的确定性下一步，不依赖浏览器智能体 API。
 * 供本地夹具和正式平台共用：打开住院病种记录 → 添加 → 填表 → 由程序提交。
 */
function getBuiltinNextAction(observation, fields, session) {
  session = session || {}
  var kind = pageKind(observation)
  if (session.stopAtIndex) {
    if (kind === 'index') return { action: 'done', target: '', value: '', message: '已在住院病种列表' }
    if (kind === 'create') return { action: 'wait', target: '', value: '', message: '等待新增表单关闭' }
  } else {
    if (areTargetFieldsFilled(observation, fields)) {
      return { action: 'done', target: '', value: '', message: '字段已填入' }
    }
    var missing = getNextMissingFieldAction(observation, fields)
    if (missing) return missing
    if (session.createOpened || isCreateFormOpen(observation) || kind === 'create') {
      return { action: 'wait', target: '', value: '', message: '等待新增表单字段' }
    }
  }
  if (kind === 'index' && hasControlText(observation, '添加')) {
    return { action: 'click', target: '添加', value: '', message: '打开新增住院病种' }
  }
  if (hasControlText(observation, '住院病种记录')) {
    return { action: 'click', target: '住院病种记录', value: '', message: '进入住院病种记录' }
  }
  if (kind === 'home' && observationText(observation).includes('住院病种记录')) {
    return { action: 'click', target: '住院病种记录', value: '', message: '进入住院病种记录' }
  }
  return null
}

function createTemplateAction(action, fields) {
  if (action.action !== 'fill') return { action: action.action, target: action.target }
  var fieldName = Object.entries(fields || {}).find(([, value]) => String(value) === String(action.value))?.[0]
  return fieldName
    ? { action: 'fill', target: action.target, fieldName }
    : { action: 'fill', target: action.target, value: action.value }
}

const PAGE_HELPER_SCRIPT = `
  const visible = (element) => {
    try {
      const style = element.ownerDocument.defaultView.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetWidth > 0 && element.offsetHeight > 0;
    } catch {
      return false;
    }
  };
  const frameSrcOf = (frame, doc) => {
    const parts = [];
    try { if (frame.src) parts.push(frame.src); } catch {}
    try { const attr = frame.getAttribute('src'); if (attr) parts.push(attr); } catch {}
    try { if (doc && doc.location && doc.location.href) parts.push(doc.location.href); } catch {}
    return parts.join('\\n');
  };
  const isCreateSrc = (src) => {
    const text = String(src || '');
    return text.includes('/HospitalizationRecord/Create')
      || (text.includes('/HospitalizationRecord/Detail') && (/[?&]type=Add\\b/i.test(text) || /\\/Detail\\/0(\\b|\\?|$)/.test(text)));
  };
  const createIsOpen = (entries) => entries.some((entry) => {
    if (isCreateSrc(entry.src)) return true;
    try { return Boolean(entry.doc && entry.doc.querySelector('[name="HospitalizationCode"], #HospitalizationCode')); }
    catch { return false; }
  });
  const locationName = (src) => isCreateSrc(src) ? '新增表单' : String(src || '').includes('/HospitalizationRecord/Index') ? '记录列表' : '主页面';
  const collectDocs = (rootDoc, rootSrc) => {
    const entries = [{ doc: rootDoc, src: rootSrc || '' }];
    const walk = (doc, depth) => {
      if (!doc || depth > 6) return;
      for (const frame of doc.querySelectorAll('iframe')) {
        let inner = null;
        try { inner = frame.contentDocument; } catch { inner = null; }
        const src = frameSrcOf(frame, inner);
        if (inner) {
          entries.push({ doc: inner, src });
          walk(inner, depth + 1);
        } else {
          entries.push({ doc: null, src });
        }
      }
    };
    walk(rootDoc, 0);
    return entries;
  };
`

const OBSERVE_PAGE_SCRIPT = `(() => {
  ${PAGE_HELPER_SCRIPT}
  const collect = (doc) => {
    if (!doc) return { text: '', controls: [] };
    return {
      text: (doc.body?.innerText || '').slice(0, 9000),
      controls: [...doc.querySelectorAll('button,a,input,textarea,select,[role="button"]')]
        .filter(visible)
        .slice(0, 160)
        .map((element) => ({
          tag: element.tagName,
          text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 120),
          name: element.getAttribute('name') || '',
          id: element.id || '',
          placeholder: element.getAttribute('placeholder') || '',
          type: element.getAttribute('type') || '',
          value: 'value' in element ? String(element.value || '').slice(0, 300) : '',
        })),
    };
  };
  const docs = collectDocs(document, location.href);
  return {
    url: location.href,
    title: document.title,
    main: collect(document),
    frames: docs.slice(1).map((entry) => ({
      src: entry.src,
      accessible: Boolean(entry.doc),
      ...(entry.doc ? collect(entry.doc) : { text: '', controls: [] }),
    })).filter((frame) => frame.src || frame.accessible),
  };
})()`

function buildExecuteBrowserActionScript(action) {
  return `(() => {
    ${PAGE_HELPER_SCRIPT}
    const action = ${JSON.stringify(action)};
    const entries = collectDocs(document, location.href).filter((entry) => entry.doc);
    if (action.action === 'click' && String(action.target || '').trim() === '添加' && createIsOpen(entries)) {
      return { ok: true, message: '新增表单已打开，跳过再次点击添加' };
    }
    const submitTargets = ${JSON.stringify(SUBMIT_TARGETS)};
    entries.sort((left, right) => {
      if (action.action === 'fill' || (action.action === 'click' && submitTargets.includes(String(action.target || '').trim()))) {
        return Number(isCreateSrc(right.src)) - Number(isCreateSrc(left.src));
      }
      if (action.action === 'click') return Number(String(right.src).includes('/HospitalizationRecord/Index')) - Number(String(left.src).includes('/HospitalizationRecord/Index'));
      return 0;
    });
    const selector = action.action === 'fill' ? 'input,textarea,select' : 'button,a,input[type="button"],input[type="submit"],[role="button"]';
    const controls = entries.flatMap((entry, documentIndex) => [...entry.doc.querySelectorAll(selector)].map((element) => ({ element, src: entry.src, documentIndex })))
      .filter((candidate) => visible(candidate.element) && !candidate.element.disabled && !candidate.element.readOnly);
    const target = String(action.target || '').trim().toLowerCase();
    const score = (candidate) => {
      const element = candidate.element;
      const parentText = element.closest('.layui-form-item,.layui-layer,.form-group,form,body')?.innerText || '';
      const directValues = [element.innerText, element.getAttribute('aria-label'), element.getAttribute('placeholder'), element.getAttribute('name'), element.id]
        .map((value) => String(value || '').trim().toLowerCase());
      let points = 0;
      if (directValues.some((value) => value === target)) points += 120;
      if (directValues.some((value) => value.includes(target))) points += 70;
      if (target === '住院号' && directValues.includes('hospitalizationcode')) points += 180;
      if (String(parentText).toLowerCase().includes(target)) points += 40;
      if (action.action === 'fill' && isCreateSrc(candidate.src)) points += 200;
      if (action.action === 'click' && target === '添加' && String(candidate.src).includes('/HospitalizationRecord/Index') && !isCreateSrc(candidate.src)) points += 200;
      if (action.action === 'click' && submitTargets.includes(String(action.target || '').trim()) && isCreateSrc(candidate.src)) points += 240;
      if (action.action === 'click' && submitTargets.includes(String(action.target || '').trim()) && (element.id === 'btnSearch' || String(element.className).includes('layui-laypage-btn'))) points -= 300;
      if (action.action === 'click' && ['取消', '关闭'].includes(String(action.target || '').trim())) points -= 120;
      return points;
    };
    const selected = controls.map((candidate) => ({ ...candidate, points: score(candidate) })).filter((candidate) => candidate.points > 0).sort((left, right) => right.points - left.points)[0];
    const element = selected?.element;
    if (!element) return { ok: false, message: '未找到目标控件：' + action.target };
    if (action.action === 'click') element.click();
    if (action.action === 'fill') {
      element.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      if (valueSetter) valueSetter.call(element, action.value || '');
      else element.value = action.value || '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return { ok: true, message: action.action + '：' + action.target + '（' + locationName(selected.src) + '）' };
  })()`
}

function buildFillCreateFormScript(fields) {
  return `(() => {
    ${PAGE_HELPER_SCRIPT}
    const fields = ${JSON.stringify(getFillableFieldEntries(fields))};
    const entries = collectDocs(document, location.href).filter((entry) => entry.doc);
    const preferred = entries.filter((entry) => isCreateSrc(entry.src) || Boolean(entry.doc.querySelector('[name="HospitalizationCode"], #HospitalizationCode')));
    const docs = preferred;
    if (!docs.length) {
      return { ok: false, filled: [], missing: fields.map((field) => field.target), message: '新增表单控件尚未出现' };
    }
    const setValue = (element, value) => {
      if (element.type === 'radio' || element.type === 'checkbox') {
        if (!element.checked) element.click();
        return;
      }
      element.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      if (valueSetter) valueSetter.call(element, value);
      else element.value = value;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      const doc = element.ownerDocument;
      const jq = doc.defaultView && (doc.defaultView.jQuery || doc.defaultView.$ || doc.defaultView.layui && doc.defaultView.layui.jquery);
      if (jq) jq(element).val(value).trigger('input').trigger('change');
    };
    const filled = [];
    const missing = [];
    for (const field of fields) {
      const target = String(field.target || '').trim().toLowerCase();
      const names = (field.names || [field.key, field.target]).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
      const controls = docs.flatMap((entry) => [...entry.doc.querySelectorAll('input,textarea,select')].map((element) => ({ element, src: entry.src })))
        .filter((candidate) => visible(candidate.element) && !candidate.element.disabled && !candidate.element.readOnly);
      const scored = controls.map((candidate) => {
        const element = candidate.element;
        const parentText = element.closest('.layui-form-item,.layui-layer,.form-group,form,label,body')?.innerText || '';
        const directValues = [element.getAttribute('name'), element.id, element.getAttribute('placeholder'), element.getAttribute('aria-label'), element.value]
          .map((value) => String(value || '').trim().toLowerCase());
        let points = 0;
        if (directValues.some((value) => names.includes(value))) points += 180;
        if (directValues.includes(target)) points += 160;
        if (directValues.some((value) => names.some((name) => name && value.includes(name)) || (target && value.includes(target)))) points += 80;
        if (target && String(parentText).toLowerCase().includes(target)) points += 50;
        if (element.type === 'radio' && names.includes(String(element.value || '').trim().toLowerCase())) points += 120;
        if (isCreateSrc(candidate.src)) points += 200;
        return { ...candidate, points };
      }).filter((candidate) => candidate.points > 0).sort((left, right) => right.points - left.points);
      const selected = scored[0];
      if (!selected) {
        missing.push(field.target);
        continue;
      }
      if (selected.element.type === 'radio' || String(selected.element.value || '') !== String(field.value || '')) setValue(selected.element, field.value);
      filled.push(field.target);
    }
    const visit = docs[0].doc.querySelector('input[name="Visit"][value="主管"]');
    if (visit && !visit.checked) visit.click();
    return {
      ok: missing.length === 0 && filled.length > 0,
      filled,
      missing,
      message: filled.length
        ? ('已填入新增表单：' + filled.join('、') + (missing.length ? '；仍缺：' + missing.join('、') : ''))
        : '新增表单控件尚未出现',
    };
  })()`
}

function buildSubmitCreateFormScript() {
  return `(() => {
    ${PAGE_HELPER_SCRIPT}
    const entries = collectDocs(document, location.href).filter((entry) => entry.doc);
    const createDocs = entries.filter((entry) => isCreateSrc(entry.src) || Boolean(entry.doc.querySelector('[name="HospitalizationCode"], #HospitalizationCode')));
    if (!createDocs.length) return { ok: false, message: '未找到新增表单，无法提交' };
    const doc = createDocs[0].doc;
    const btn = doc.querySelector('button[lay-filter="btnOK"], [lay-submit][lay-filter="btnOK"]')
      || [...doc.querySelectorAll('button')].find((element) => (element.innerText || '').trim() === '确定' && element.id !== 'btnSearch' && !String(element.className).includes('layui-laypage-btn'));
    if (!btn) return { ok: false, message: '未找到新增表单里的确定按钮' };
    btn.click();
    return { ok: true, message: '已点击新增表单「确定」提交', location: locationName(createDocs[0].src) };
  })()`
}

function buildReadSubmitStatusScript() {
  return `(() => {
    ${PAGE_HELPER_SCRIPT}
    const entries = collectDocs(document, location.href);
    const createOpen = createIsOpen(entries);
    const texts = entries.flatMap((entry) => {
      const doc = entry.doc || document;
      try {
        return [...doc.querySelectorAll('.layui-layer-dialog .layui-layer-content, .layui-layer-msg, .layui-layer-hui')].map((element) => String(element.innerText || '').trim());
      } catch {
        return [];
      }
    }).filter(Boolean);
    const message = texts[0] || '';
    const error = texts.find((text) => /失败|请输入|请选择|不能|错误/.test(text)) || '';
    return { closed: !createOpen, createOpen, message, error };
  })()`
}

function buildRefreshIndexSearchScript(fields, options) {
  var wideDates = Boolean(options && options.wideDates)
  return `(() => {
    ${PAGE_HELPER_SCRIPT}
    const patientName = ${JSON.stringify(String(fields?.PatientName || ''))};
    const creationTime = ${JSON.stringify(String(fields?.CreationTime || ''))};
    const wideDates = ${JSON.stringify(wideDates)};
    const today = ${JSON.stringify(new Date().toISOString().slice(0, 10))};
    const entries = collectDocs(document, location.href).filter((entry) => entry.doc && String(entry.src || '').includes('/HospitalizationRecord/Index') && !isCreateSrc(entry.src));
    const doc = (entries[0] && entries[0].doc) || null;
    if (!doc) return { ok: false, message: '未找到住院病种列表，无法核对提交结果' };
    const nameInput = doc.querySelector('#txtPatientName') || doc.querySelector('input[name="PatientName"]');
    const startInput = doc.querySelector('#StartDate');
    const endInput = doc.querySelector('#EndDate');
    const searchBtn = doc.querySelector('#btnSearch');
    if (nameInput && patientName) {
      nameInput.value = patientName;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (startInput) {
      const nextStart = wideDates
        ? (creationTime && creationTime < '2020-01-01' ? creationTime : '2020-01-01')
        : (creationTime && (!startInput.value || creationTime < startInput.value) ? creationTime : startInput.value);
      if (nextStart && nextStart !== startInput.value) {
        startInput.value = nextStart;
        startInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (endInput) {
      const nextEnd = wideDates
        ? (creationTime && creationTime > today ? creationTime : today)
        : (creationTime && (!endInput.value || creationTime > endInput.value) ? creationTime : endInput.value);
      if (nextEnd && nextEnd !== endInput.value) {
        endInput.value = nextEnd;
        endInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (doc.defaultView && typeof doc.defaultView.search === 'function') doc.defaultView.search(1);
    else if (searchBtn) searchBtn.click();
    return {
      ok: true,
      message: '已按姓名和住院日期刷新列表核对：' + (patientName || '') + (creationTime ? ' / ' + creationTime : ''),
    };
  })()`
}

function buildReadExistingRecordsScript() {
  return `(() => {
    ${PAGE_HELPER_SCRIPT}
    const headerIndex = (headers, pattern) => headers.findIndex((header) => pattern.test(header));
    const collectRows = (headers, bodyRows) => {
      const nameIdx = headerIndex(headers, /病人姓名|姓名/);
      const noIdx = headerIndex(headers, /住院号/);
      const dateIdx = headerIndex(headers, /住院日期|入院日期/);
      return [...bodyRows].map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map((td) => String(td.innerText || '').trim());
        return {
          PatientName: nameIdx >= 0 ? (cells[nameIdx] || '') : '',
          HospitalNo: noIdx >= 0 ? (cells[noIdx] || '') : '',
          CreationTime: dateIdx >= 0 ? (cells[dateIdx] || '') : '',
          cells,
        };
      }).filter((row) => {
        const joined = (row.cells || []).join('');
        return joined && !/暂无|无数据/.test(joined);
      });
    };
    const entries = collectDocs(document, location.href).filter((entry) => entry.doc && (String(entry.src || '').includes('/HospitalizationRecord/Index') || entry.doc.querySelector('table')));
    const rows = [];
    const texts = [];
    for (const entry of entries) {
      if (isCreateSrc(entry.src)) continue;
      const doc = entry.doc;
      texts.push(String(doc.body && doc.body.innerText || '').slice(0, 9000));
      const views = [...doc.querySelectorAll('.layui-table-view')];
      if (views.length) {
        views.forEach((view) => {
          const headers = [...view.querySelectorAll('.layui-table-header th, .layui-table-header td')].map((el) => String(el.innerText || '').trim());
          rows.push(...collectRows(headers, view.querySelectorAll('.layui-table-body tbody tr, .layui-table-box tbody tr')));
        });
        continue;
      }
      [...doc.querySelectorAll('table')].forEach((table) => {
        const headers = [...table.querySelectorAll('thead th, thead td, tr:first-child th')].map((el) => String(el.innerText || '').trim());
        const bodyRows = table.querySelectorAll('tbody tr');
        rows.push(...collectRows(headers.length ? headers : [...(table.querySelector('tr') ? table.querySelector('tr').querySelectorAll('th,td') : [])].map((el) => String(el.innerText || '').trim()), bodyRows.length ? bodyRows : table.querySelectorAll('tr')));
      });
    }
    return {
      ok: true,
      rows,
      text: texts.join('\\n'),
      message: rows.length ? ('列表读到 ' + rows.length + ' 条') : '列表暂无已有记录',
    };
  })()`
}

module.exports = {
  CORE_FIELD_KEYS,
  SUBMIT_TARGETS,
  FIELD_TARGETS,
  FIELD_NAMES,
  OBSERVE_PAGE_SCRIPT,
  sleep,
  coreFieldValues,
  getFillableFieldEntries,
  getObservationControls,
  areTargetFieldsFilled,
  getFillRecords,
  normalizeHospitalNo,
  recordHospitalNo,
  dedupeFillRecords,
  isExistingRecord,
  shouldSubmit,
  isCreateSrc,
  getCreateFrame,
  createFrameHasInputs,
  isCreateFormOpen,
  getNextMissingFieldAction,
  isSubmitTarget,
  withoutSubmitActions,
  summarizeObservation,
  getBuiltinNextAction,
  createTemplateAction,
  buildExecuteBrowserActionScript,
  buildFillCreateFormScript,
  buildSubmitCreateFormScript,
  buildReadSubmitStatusScript,
  buildRefreshIndexSearchScript,
  buildReadExistingRecordsScript,
  pageKind,
}
