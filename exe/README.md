# 病例自动传桌面版

Electron 桌面应用：OCR 识别病例图片、导出 Excel，并支持登录业务平台自动填入字段。

```powershell
npm install
npm run electron:dev
npm run dist:win
```

安装包输出到 `release/`：

- `病例自动传-0.1.0-安装包.exe`：发给别人双击安装即可，无需 Node.js
- `病例自动传-0.1.0-win-x64.zip`：解压后直接运行 `病例自动传.exe`

对方首次使用需自行填写 OCR Key 和平台账号。OCR 密钥保存在本机，不会打进安装包。
