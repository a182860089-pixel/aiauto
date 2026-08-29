export type ExtractedField = {
  key: string;
  label: string;
  value: string;
  required?: boolean;
}

export type CaseSample = {
  title: string;
  source: string;
  summary: string;
  fields: ExtractedField[];
}

export const defaultFields: ExtractedField[] = [
  { key: 'patientName', label: '患者姓名', value: '张三', required: true },
  { key: 'gender', label: '性别', value: '男', required: true },
  { key: 'age', label: '年龄', value: '56岁', required: true },
  { key: 'admissionDate', label: '入院日期', value: '2026-07-24', required: true },
  { key: 'diagnosis', label: '诊断', value: '肺部感染', required: true },
  { key: 'chiefComplaint', label: '主诉', value: '咳嗽、发热 3 天', required: false },
  { key: 'course', label: '病程描述', value: '患者近三日咳嗽伴发热，精神可，拟完善检查后处理。', required: false },
  { key: 'treatment', label: '处理意见', value: '建议继续观察，补液及对症支持治疗。', required: false },
]

export const samples: CaseSample[] = [
  {
    title: '住院病程记录',
    source: '示意截图A',
    summary: '常见住院病程片段，适合验证标题、日期和诊断抽取。',
    fields: defaultFields,
  },
  {
    title: '结转/转科记录',
    source: '示意截图B',
    summary: '适合验证多段内容合并和自定义字段映射。',
    fields: [
      { key: 'patientName', label: '患者姓名', value: '李四', required: true },
      { key: 'gender', label: '性别', value: '女', required: true },
      { key: 'age', label: '年龄', value: '42岁', required: true },
      { key: 'transferReason', label: '转科原因', value: '病情需要进一步专科处理', required: true },
      { key: 'transferDepartment', label: '转入科室', value: '呼吸内科', required: true },
      { key: 'diagnosis', label: '诊断', value: '社区获得性肺炎', required: true },
      { key: 'notes', label: '备注', value: '患者生命体征平稳，已完成交接。', required: false },
    ],
  },
]

export const buildFieldMap = (fields: ExtractedField[]) =>
  Object.fromEntries(fields.map((field) => [field.key, field])) as Record<string, ExtractedField>

export const buildSelectedSnapshot = (fields: ExtractedField[], selectedKeys: Set<string>) =>
  fields.filter((field) => selectedKeys.has(field.key))