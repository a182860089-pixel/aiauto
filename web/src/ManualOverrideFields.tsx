import { DEFAULT_DEPARTMENT_OPTIONS, RECORD_CATEGORY_OPTIONS, mergeDepartmentOptions } from './templateMapping'

type ManualOverrideFieldsProps = {
  recordCategory: string
  department: string
  customDepartments?: string[]
  onRecordCategoryChange: (value: string) => void
  onDepartmentChange: (value: string) => void
}

/**
 * 图片里没有的两列：记录类别下拉，所在科室可下拉也可手输。
 * @param props 当前值和变更回调
 * @return 人工补填区域
 */
export default function ManualOverrideFields(props: ManualOverrideFieldsProps) {
  var departmentOptions = mergeDepartmentOptions(props.customDepartments)
  return (
    <div className="manual-override-panel">
      <div className="panel-header">
        <div>
          <h3>人工补填字段</h3>
          <p className="section-subtitle">先识别出表格，再勾选行并指定类别和科室，最后才写入 Excel</p>
        </div>
      </div>
      <div className="manual-override-grid">
        <label className="config-field">
          <span>记录类别</span>
          <select value={props.recordCategory} onChange={(event) => props.onRecordCategoryChange(event.target.value)}>
            <option value="">请选择记录类别</option>
            {RECORD_CATEGORY_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="config-field">
          <span>所在科室</span>
          <input
            list="department-options"
            value={props.department}
            onChange={(event) => props.onDepartmentChange(event.target.value)}
            placeholder="下拉选择，或直接输入新科室"
          />
          <datalist id="department-options">
            {departmentOptions.map((item) => <option key={item} value={item} />)}
          </datalist>
        </label>
      </div>
    </div>
  )
}

export { DEFAULT_DEPARTMENT_OPTIONS, RECORD_CATEGORY_OPTIONS }