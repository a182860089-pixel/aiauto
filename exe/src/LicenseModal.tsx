import { useState, useEffect } from 'react'

interface LicenseModalProps {
  isOpen: boolean
  onClose: () => void
  onLicenseChanged?: (status: LicenseStatus) => void
}

export default function LicenseModal({ isOpen, onClose, onLicenseChanged }: LicenseModalProps) {
  const [machineId, setMachineId] = useState('')
  const [licenseCode, setLicenseCode] = useState('')
  const [serverUrl, setServerUrl] = useState('http://127.0.0.1:3000')
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [showServerSetting, setShowServerSetting] = useState(false)

  const refreshStatus = async () => {
    if (!window.desktopApi) return
    try {
      const mid = await window.desktopApi.getMachineId()
      setMachineId(mid)
      const cfg = await window.desktopApi.getLicenseConfig()
      if (cfg.serverUrl) setServerUrl(cfg.serverUrl)
      if (cfg.code) setLicenseCode(cfg.code)

      const status = await window.desktopApi.getLicenseStatus()
      setLicenseStatus(status)
      if (onLicenseChanged) onLicenseChanged(status)
    } catch (err) {
      console.error('获取授权状态失败:', err)
    }
  }

  useEffect(() => {
    if (isOpen) {
      setMsg(null)
      refreshStatus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleCopyMachineId = () => {
    if (!machineId) return
    navigator.clipboard.writeText(machineId).then(() => {
      setMsg({ text: '机器码已复制到剪贴板！', type: 'success' })
    }).catch(() => {
      setMsg({ text: '复制失败，请手动选择复制', type: 'error' })
    })
  }

  const handleActivate = async () => {
    if (!licenseCode.trim()) {
      setMsg({ text: '请输入卡密后再点击激活', type: 'error' })
      return
    }
    if (!window.desktopApi) {
      setMsg({ text: '当前非桌面运行环境', type: 'error' })
      return
    }

    setLoading(true)
    setMsg({ text: '正在验证卡密并绑定当前机器...', type: 'info' })

    try {
      const res = await window.desktopApi.activateLicense({
        code: licenseCode.trim(),
        serverUrl: serverUrl.trim(),
      })
      if (res.success) {
        setMsg({ text: `🎉 ${res.message || '激活成功！'}（有效期：${res.remainingText || '已生效'}）`, type: 'success' })
        const status = await window.desktopApi.getLicenseStatus()
        setLicenseStatus(status)
        if (onLicenseChanged) onLicenseChanged(status)
      } else {
        setMsg({ text: res.message || '激活失败', type: 'error' })
      }
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : '激活请求失败', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleSaveServerUrl = async () => {
    if (!window.desktopApi) return
    try {
      await window.desktopApi.setLicenseServerUrl(serverUrl)
      setMsg({ text: '服务器地址已更新', type: 'success' })
      refreshStatus()
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : '保存失败', type: 'error' })
    }
  }

  const handleClear = async () => {
    if (!window.desktopApi) return
    if (!window.confirm('确定要清除本机的卡密授权吗？')) return
    try {
      await window.desktopApi.clearLicense()
      setLicenseCode('')
      setMsg({ text: '已清除本机卡密', type: 'info' })
      refreshStatus()
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : '清除失败', type: 'error' })
    }
  }

  const isActive = licenseStatus?.active

  return (
    <div className="license-modal-overlay" onMouseDown={onClose}>
      <div className="license-modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="license-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '20px' }}>🛡️</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>软件授权与卡密激活</h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>一机一码授权验证系统</p>
            </div>
          </div>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="license-modal-body">
          {msg && (
            <div className={`license-alert license-alert-${msg.type}`}>
              {msg.text}
            </div>
          )}

          {/* 机器码展示区域 */}
          <div className="license-section">
            <label className="license-label">本机唯一机器码（一机一码）：</label>
            <div className="machine-id-box">
              <code>{machineId || '读取中...'}</code>
              <button type="button" className="copy-btn" onClick={handleCopyMachineId}>复制机器码</button>
            </div>
            <small className="license-tip">每台电脑机器码唯一，卡密激活后将自动与此机器码绑定。</small>
          </div>

          {/* 当前授权状态 */}
          <div className="license-status-card">
            <div className="license-status-row">
              <span className="label">当前授权状态：</span>
              {isActive ? (
                <span className="status-badge status-active">✅ 已授权激活</span>
              ) : (
                <span className="status-badge status-unactive">⚠️ 未激活 / 无效授权</span>
              )}
            </div>
            {isActive && (
              <>
                <div className="license-status-row">
                  <span className="label">剩余有效时长：</span>
                  <strong style={{ color: '#059669', fontSize: '14px' }}>{licenseStatus?.remainingText || '正常使用中'}</strong>
                </div>
                {licenseStatus?.expiresAt && (
                  <div className="license-status-row">
                    <span className="label">授权到期时间：</span>
                    <span style={{ color: '#475569', fontSize: '12px' }}>
                      {new Date(licenseStatus.expiresAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 卡密输入 */}
          <div className="license-section">
            <label className="license-label">输入激活卡密：</label>
            <input
              type="text"
              className="license-input"
              placeholder="例如: ABCD-1234-EFGH-5678"
              value={licenseCode}
              onChange={(e) => setLicenseCode(e.target.value.toUpperCase())}
            />
          </div>

          {/* 服务器配置折叠 */}
          <div className="license-section">
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setShowServerSetting(!showServerSetting)}
            >
              <span style={{ fontSize: '12px', color: '#475569' }}>⚙️ 授权验证服务器设置</span>
              <span style={{ fontSize: '11px', color: '#6366f1' }}>{showServerSetting ? '收起' : '展开修改'}</span>
            </div>
            {showServerSetting && (
              <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  className="license-input"
                  style={{ fontSize: '12px', padding: '6px 10px' }}
                  placeholder="http://服务器IP:3000"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                />
                <button type="button" className="copy-btn" onClick={handleSaveServerUrl}>保存</button>
              </div>
            )}
          </div>
        </div>

        <div className="license-modal-footer">
          {isActive && (
            <button type="button" className="btn-text-danger" onClick={handleClear}>
              注销卡密
            </button>
          )}
          <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
            <button type="button" className="btn-cancel" onClick={onClose}>
              关闭
            </button>
            <button type="button" className="btn-activate-primary" onClick={handleActivate} disabled={loading}>
              {loading ? '正在激活...' : (isActive ? '重新激活 / 续费' : '立即激活卡密')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
